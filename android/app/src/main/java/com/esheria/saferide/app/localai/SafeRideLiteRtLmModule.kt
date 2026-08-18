package com.esheria.saferide.app.localai

import android.os.Build
import android.util.Log
import com.esheria.saferide.app.BuildConfig
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.lang.reflect.InvocationTargetException
import java.net.URI
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicBoolean

class SafeRideLiteRtLmModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private enum class BridgeState {
    IDLE,
    PREPARED,
    LOADED,
    GENERATING,
    ERROR,
  }

  private data class BridgeConfig(
    val modelId: String,
    val manifestId: String,
    val modelPath: String?,
    val expectedFileName: String?,
    val expectedSizeBytes: Long?,
    val expectedSha256: String?,
    val mockMode: Boolean,
    val allowRealRuntime: Boolean,
    val maxOutputTokens: Int,
    val contextWindow: Int,
    val backendPlan: List<String>,
    val cachePolicy: String,
    val systemPrompt: String,
  )

  private data class ApprovedArtifactBinding(
    val modelId: String,
    val manifestId: String,
    val fileName: String,
    val sizeBytes: Long,
    val sha256: String,
  )

  private data class BridgeMessage(
    val role: String,
    val content: String,
  )

  private val cancelRequested = AtomicBoolean(false)
  private val worker = Executors.newSingleThreadExecutor()
  private val lock = Any()
  private var state = BridgeState.IDLE
  private var activeModelId: String? = null
  private var activeManifestId: String? = null
  private var activeConfig: BridgeConfig? = null
  private var activeRuntime: LiteRtRuntimeHandle? = null
  private var activeGeneration: Future<*>? = null
  private var activeBackend: String? = null
  private var lastErrorCode: String? = null
  private var lastErrorMessage: String? = null
  private var artifactValidated = false
  private var mockMode = false

  override fun getName(): String = NAME

  @ReactMethod
  fun getStatus(promise: Promise) {
    promise.resolve(statusMap())
  }

  @ReactMethod
  fun prepare(config: ReadableMap, promise: Promise) {
    try {
      val bridgeConfig = parseConfig(config)
      validateControlledConfig(bridgeConfig, requirePath = false, verifyIntegrity = false)
      synchronized(lock) {
        state = BridgeState.PREPARED
        activeModelId = bridgeConfig.modelId
        activeManifestId = bridgeConfig.manifestId
        activeConfig = bridgeConfig
        mockMode = bridgeConfig.mockMode
        activeBackend = null
        artifactValidated = false
        clearErrorLocked()
      }
      promise.resolve(statusMap())
    } catch (error: BridgeError) {
      rejectWithBridgeError(error, promise)
    } catch (_: Exception) {
      rejectWithBridgeError(BridgeError(ERR_INVALID_CONFIG, "LiteRT-LM bridge configuration is invalid."), promise)
    }
  }

  @ReactMethod
  fun load(config: ReadableMap, promise: Promise) {
    val bridgeConfig = try {
      parseConfig(config)
    } catch (_: Exception) {
      rejectWithBridgeError(BridgeError(ERR_INVALID_CONFIG, "LiteRT-LM bridge configuration is invalid."), promise)
      return
    }

    worker.execute {
      try {
        val modelFile = validateControlledConfig(
          bridgeConfig,
          requirePath = !bridgeConfig.mockMode,
          verifyIntegrity = !bridgeConfig.mockMode,
        )

        if (bridgeConfig.mockMode) {
          replaceRuntime(null)
          synchronized(lock) {
            state = BridgeState.LOADED
            activeModelId = bridgeConfig.modelId
            activeManifestId = bridgeConfig.manifestId
            activeConfig = bridgeConfig
            mockMode = true
            activeBackend = "mock"
            artifactValidated = false
            cancelRequested.set(false)
            clearErrorLocked()
          }
          promise.resolve(statusMap())
          return@execute
        }

        if (!BuildConfig.SAFERIDE_LITERTLM_REAL_RUNTIME_ALLOWED || !bridgeConfig.allowRealRuntime) {
          throw BridgeError(
            ERR_REAL_RUNTIME_DISABLED,
            "Local AI is not enabled in this build.",
          )
        }
        if (!isLiteRtLmRuntimeAvailable()) {
          throw BridgeError(
            ERR_RUNTIME_UNAVAILABLE,
            "LiteRT-LM Android runtime dependency is not available in this build.",
          )
        }

        val runtime = createLiteRtRuntime(bridgeConfig, modelFile ?: throw BridgeError(
          ERR_MODEL_FILE_MISSING,
          "Local model file is missing.",
        ))
        replaceRuntime(runtime)
        synchronized(lock) {
          state = BridgeState.LOADED
          activeModelId = bridgeConfig.modelId
          activeManifestId = bridgeConfig.manifestId
          activeConfig = bridgeConfig
          mockMode = false
          activeBackend = runtime.backendLabel
          artifactValidated = true
          cancelRequested.set(false)
          clearErrorLocked()
        }
        promise.resolve(statusMap())
      } catch (error: BridgeError) {
        synchronized(lock) {
          state = BridgeState.ERROR
          artifactValidated = false
        }
        rejectWithBridgeError(error, promise)
      } catch (error: Exception) {
        synchronized(lock) {
          state = BridgeState.ERROR
          artifactValidated = false
        }
        Log.w(LOG_TAG, "LiteRT-LM bridge load failed: ${safeThrowableSummary(error)}")
        rejectWithBridgeError(BridgeError(ERR_LOAD_FAILED, "LiteRT-LM bridge load failed."), promise)
      }
    }
  }

  @ReactMethod
  fun generate(messages: ReadableArray, options: ReadableMap?, promise: Promise) {
    val bridgeMessages = parseMessages(messages)
    val generationOptions = parseGenerationOptions(options)

    val snapshot = try {
      synchronized(lock) {
        if (state != BridgeState.LOADED || activeModelId == null || activeManifestId == null || activeConfig == null) {
          throw BridgeError(ERR_NOT_LOADED, "LiteRT-LM bridge must be loaded before generation.")
        }
        Triple(activeRuntime, activeConfig, mockMode)
      }
    } catch (error: BridgeError) {
      rejectWithBridgeError(error, promise)
      return
    }
    val runtime = snapshot.first
    val bridgeConfig = snapshot.second ?: run {
      rejectWithBridgeError(BridgeError(ERR_NOT_LOADED, "LiteRT-LM bridge must be loaded before generation."), promise)
      return
    }
    val isMockMode = snapshot.third

    cancelRequested.set(false)
    synchronized(lock) {
      state = BridgeState.GENERATING
      clearErrorLocked()
    }

    val future = worker.submit {
      try {
        if (isMockMode) {
          val userMessage = latestUserMessage(bridgeMessages)
          if (cancelRequested.get()) {
            throw BridgeError(ERR_CANCELLED, "LiteRT-LM generation was cancelled.")
          }
          val response = Arguments.createMap()
          response.putString("content", mockResponse(userMessage))
          response.putString("sourceLabel", "SafeRide local AI")
          response.putString("modelId", activeModelId)
          response.putString("manifestId", activeManifestId)
          response.putBoolean("mockMode", true)
          synchronized(lock) {
            state = BridgeState.LOADED
            clearErrorLocked()
          }
          promise.resolve(response)
          return@submit
        }

        val handle = runtime ?: throw BridgeError(ERR_NOT_LOADED, "LiteRT-LM runtime is not loaded.")
        val prompt = renderSingleTurnPrompt(bridgeMessages)
        val content = handle.generate(prompt, bridgeConfig, generationOptions).trim()
        if (cancelRequested.get()) {
          throw BridgeError(ERR_CANCELLED, "LiteRT-LM generation was cancelled.")
        }
        if (content.isBlank()) {
          throw BridgeError(ERR_EMPTY_RESPONSE, "LiteRT-LM bridge returned an empty response.")
        }

        val response = Arguments.createMap()
        response.putString("content", content)
        response.putString("sourceLabel", "SafeRide local AI")
        response.putString("modelId", activeModelId)
        response.putString("manifestId", activeManifestId)
        response.putBoolean("mockMode", false)
        response.putString("activeBackend", handle.backendLabel)
        response.putString("backendLabel", handle.backendLabel)
        synchronized(lock) {
          state = BridgeState.LOADED
          clearErrorLocked()
        }
        promise.resolve(response)
      } catch (error: BridgeError) {
        synchronized(lock) {
          state = if (error.code == ERR_CANCELLED) BridgeState.LOADED else BridgeState.ERROR
        }
        if (error.code != ERR_CANCELLED) {
          Log.w(LOG_TAG, "LiteRT-LM bridge generation rejected: ${error.code}")
        }
        rejectWithBridgeError(error, promise)
      } catch (error: Exception) {
        synchronized(lock) {
          state = BridgeState.ERROR
        }
        Log.w(LOG_TAG, "LiteRT-LM bridge generation failed: ${safeThrowableSummary(error)}")
        rejectWithBridgeError(BridgeError(ERR_GENERATE_FAILED, "LiteRT-LM bridge generation failed."), promise)
      } finally {
        synchronized(lock) {
          activeGeneration = null
        }
      }
    }

    synchronized(lock) {
      activeGeneration = future
    }
  }

  @ReactMethod
  fun cancel(promise: Promise) {
    cancelRequested.set(true)
    synchronized(lock) {
      activeRuntime?.cancelActiveConversation()
      activeGeneration?.cancel(true)
      if (state == BridgeState.GENERATING) {
        state = BridgeState.LOADED
      }
    }
    promise.resolve(statusMap())
  }

  @ReactMethod
  fun unload(promise: Promise) {
    worker.execute {
      cancelRequested.set(true)
      replaceRuntime(null)
      synchronized(lock) {
        activeGeneration = null
        state = BridgeState.IDLE
        activeModelId = null
        activeManifestId = null
        activeConfig = null
        activeBackend = null
        artifactValidated = false
        mockMode = false
        clearErrorLocked()
      }
      promise.resolve(statusMap())
    }
  }

  private fun parseConfig(config: ReadableMap): BridgeConfig {
    val modelId = config.getRequiredString("modelId")
    val manifestId = config.getRequiredString("manifestId")
    val modelPath = config.getNullableString("modelPath")
    val maxOutputTokens = if (config.hasKey("maxOutputTokens")) config.getInt("maxOutputTokens") else 128
    val contextWindow = if (config.hasKey("contextWindow")) config.getInt("contextWindow") else 2048
    return BridgeConfig(
      modelId = modelId,
      manifestId = manifestId,
      modelPath = modelPath,
      expectedFileName = config.getNullableString("expectedFileName"),
      expectedSizeBytes = config.getNullableLong("expectedSizeBytes"),
      expectedSha256 = config.getNullableString("expectedSha256")?.lowercase(Locale.US),
      mockMode = config.hasKey("mockMode") && config.getBoolean("mockMode"),
      allowRealRuntime = config.hasKey("allowRealRuntime") && config.getBoolean("allowRealRuntime"),
      maxOutputTokens = maxOutputTokens,
      contextWindow = contextWindow,
      backendPlan = config.getNullableStringArray("backendPlan"),
      cachePolicy = config.getNullableString("cachePolicy") ?: "app-cache",
      systemPrompt = config.getNullableString("systemPrompt") ?: DEFAULT_SYSTEM_PROMPT,
    )
  }

  private fun parseGenerationOptions(options: ReadableMap?): GenerationOptions {
    if (options == null) return GenerationOptions()
    val maxOutputTokens = if (options.hasKey("maxOutputTokens")) options.getInt("maxOutputTokens") else null
    val temperature = if (options.hasKey("temperature")) options.getDouble("temperature") else null
    return GenerationOptions(maxOutputTokens = maxOutputTokens, temperature = temperature)
  }

  private fun parseMessages(messages: ReadableArray): List<BridgeMessage> {
    val parsed = mutableListOf<BridgeMessage>()
    for (index in 0 until messages.size()) {
      val message = messages.getMap(index) ?: continue
      val role = message.getNullableString("role")?.lowercase(Locale.US) ?: "user"
      val content = message.getNullableString("content")?.trim().orEmpty()
      if (content.isNotBlank()) {
        parsed.add(BridgeMessage(role = role, content = content))
      }
    }
    return parsed
  }

  private fun validateControlledConfig(
    config: BridgeConfig,
    requirePath: Boolean,
    verifyIntegrity: Boolean,
  ): File? {
    val expectedFileName = config.expectedFileName
    val expectedSizeBytes = config.expectedSizeBytes
    val expectedSha256 = config.expectedSha256
    if (
      !isSafeNamespacedModelId(config.modelId) ||
      !isSafePathSegment(config.manifestId) ||
      !isSafePathSegment(expectedFileName)
    ) {
      throw BridgeError(ERR_INVALID_CONFIG, "Local AI artifact identity is invalid.")
    }
    if (expectedFileName.isNullOrBlank() || !expectedFileName.endsWith(".litertlm")) {
      throw BridgeError(ERR_INVALID_CONFIG, "Local AI artifact metadata is incomplete.")
    }
    if (expectedSizeBytes == null || expectedSizeBytes <= 0) {
      throw BridgeError(ERR_INVALID_CONFIG, "Local AI artifact metadata is incomplete.")
    }
    if (expectedSha256 == null || !SHA256_PATTERN.matches(expectedSha256)) {
      throw BridgeError(ERR_INVALID_CONFIG, "Local AI artifact metadata is incomplete.")
    }
    val approvedBinding = APPROVED_ARTIFACT_BINDINGS.any { binding ->
      binding.modelId == config.modelId &&
        binding.manifestId == config.manifestId &&
        binding.fileName == expectedFileName &&
        binding.sizeBytes == expectedSizeBytes &&
        binding.sha256 == expectedSha256
    }
    if (!approvedBinding) {
      throw BridgeError(ERR_UNSUPPORTED_MANIFEST, "This local model is not approved for this build.")
    }
    if (config.maxOutputTokens <= 0 || config.maxOutputTokens > 256) {
      throw BridgeError(ERR_INVALID_CONFIG, "Local AI setup is invalid.")
    }
    if (config.contextWindow <= 0 || config.contextWindow > 32_000) {
      throw BridgeError(ERR_INVALID_CONFIG, "Local AI setup is invalid.")
    }
    val path = config.modelPath?.trim().orEmpty()
    if (!requirePath && path.isBlank()) return null
    if (!path.endsWith(".litertlm")) {
      throw BridgeError(ERR_INVALID_MODEL_PATH, "Local model file is invalid.")
    }

    val file = fileFromBridgePath(path)
    if (file.name != expectedFileName) {
      throw BridgeError(ERR_INVALID_MODEL_PATH, "Local model file is invalid.")
    }
    validateAppStorageBoundary(file)
    if (!file.exists() || !file.isFile) {
      throw BridgeError(ERR_MODEL_FILE_MISSING, "Local model file is missing.")
    }
    if (file.length() != expectedSizeBytes) {
      throw BridgeError(ERR_MODEL_SIZE_MISMATCH, "Local model download did not finish. Try again.")
    }
    if (verifyIntegrity && sha256Hex(file) != expectedSha256) {
      throw BridgeError(ERR_CHECKSUM_MISMATCH, "Local model check failed. Download it again.")
    }
    return file
  }

  private fun fileFromBridgePath(path: String): File {
    return try {
      if (path.startsWith("file://")) File(URI(path)) else File(path)
    } catch (_: Exception) {
      throw BridgeError(ERR_INVALID_MODEL_PATH, "Local model file is invalid.")
    }
  }

  private fun validateAppStorageBoundary(file: File) {
    val target = file.canonicalFile
    val allowedRoots = listOfNotNull(
      reactContext.filesDir,
      reactContext.cacheDir,
      reactContext.noBackupFilesDir,
      reactContext.getExternalFilesDir(null),
    ).map { it.canonicalFile }

    val insideAllowedRoot = allowedRoots.any { root ->
      target.path == root.path || target.path.startsWith(root.path + File.separator)
    }
    if (!insideAllowedRoot) {
      throw BridgeError(ERR_MODEL_PATH_OUTSIDE_APP_STORAGE, "Local model must stay inside SafeRide storage.")
    }
  }

  private fun isSafePathSegment(value: String?): Boolean =
    value != null && SAFE_PATH_SEGMENT_PATTERN.matches(value) && value != "." && value != ".."

  private fun isSafeNamespacedModelId(value: String): Boolean =
    value.length <= MAX_IDENTITY_CHARS && value.split('/').all { isSafePathSegment(it) }

  private fun isInsideDirectory(root: File, target: File): Boolean =
    target.path == root.path || target.path.startsWith(root.path + File.separator)

  private fun sha256Hex(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    BufferedInputStream(FileInputStream(file), HASH_BUFFER_SIZE).use { input ->
      val buffer = ByteArray(HASH_BUFFER_SIZE)
      while (true) {
        val read = input.read(buffer)
        if (read <= 0) break
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { byte ->
      "%02x".format(Locale.US, byte.toInt() and 0xff)
    }
  }

  private fun createLiteRtRuntime(config: BridgeConfig, modelFile: File): LiteRtRuntimeHandle {
    val classes = LiteRtReflectionClasses.load(reactContext.classLoader)
    val cacheDir = cacheDirectory(config)
    val attempts = backendAttempts(config)
    var lastError: Throwable? = null

    for (attempt in attempts) {
      var engine: Any? = null
      try {
        val engineConfig = classes.createEngineConfig(
          modelPath = modelFile.absolutePath,
          backend = classes.createBackend(attempt.backend),
          visionBackend = null,
          audioBackend = null,
          maxNumTokens = config.contextWindow,
          cacheDir = cacheDir.absolutePath,
        )
        engine = classes.engineConstructor.newInstance(engineConfig)
        classes.engineInitialize.invoke(engine)
        return LiteRtRuntimeHandle(engine, classes, attempt.label)
      } catch (error: Throwable) {
        lastError = unwrapReflectionError(error)
        Log.w(
          LOG_TAG,
          "LiteRT-LM backend ${attempt.label} initialization failed: ${safeThrowableSummary(lastError)}",
        )
        engine?.let { candidate ->
          runCatching { classes.engineClose.invoke(candidate) }
        }
      }
    }

    throw BridgeError(
      ERR_INIT_FAILED,
      "SafeRide could not start local AI on this device.",
      lastError,
    )
  }

  private fun safeThrowableSummary(error: Throwable): String {
    val message = error.message
      ?.replace(reactContext.filesDir.absolutePath, "<app-files>")
      ?.replace(reactContext.cacheDir.absolutePath, "<app-cache>")
      ?.take(MAX_DIAGNOSTIC_MESSAGE_CHARS)
      .orEmpty()
    return if (message.isBlank()) {
      error.javaClass.name
    } else {
      "${error.javaClass.name}: $message"
    }
  }

  private fun cacheDirectory(config: BridgeConfig): File {
    val root = when (config.cachePolicy) {
      "app-documents" -> reactContext.filesDir
      "app-cache" -> reactContext.cacheDir
      else -> throw BridgeError(ERR_INVALID_CONFIG, "Local AI cache policy is invalid.")
    }.canonicalFile
    val cacheRoot = File(root, "litertlm-cache").canonicalFile
    if (!isInsideDirectory(root, cacheRoot)) {
      throw BridgeError(ERR_INVALID_CONFIG, "Local AI cache path is invalid.")
    }
    if (cacheRoot.exists() && !cacheRoot.isDirectory) {
      throw BridgeError(ERR_INIT_FAILED, "SafeRide could not prepare local AI storage.")
    }
    if (!cacheRoot.exists() && !cacheRoot.mkdirs()) {
      throw BridgeError(ERR_INIT_FAILED, "SafeRide could not prepare local AI storage.")
    }
    val target = File(cacheRoot, config.manifestId).canonicalFile
    if (!isInsideDirectory(cacheRoot, target)) {
      throw BridgeError(ERR_INVALID_CONFIG, "Local AI cache path is invalid.")
    }
    if (target.exists() && !target.isDirectory) {
      throw BridgeError(ERR_INIT_FAILED, "SafeRide could not prepare local AI storage.")
    }
    if (!target.exists() && !target.mkdirs()) {
      throw BridgeError(ERR_INIT_FAILED, "SafeRide could not prepare local AI storage.")
    }
    return target
  }

  private fun backendAttempts(config: BridgeConfig): List<BackendAttempt> {
    val requested = config.backendPlan.ifEmpty { listOf("gpu", "cpu-text") }
    if (isX86Runtime()) {
      return listOf(BackendAttempt("cpu-text", "cpu"))
    }
    val attempts = mutableListOf<BackendAttempt>()
    for (backend in requested) {
      when (backend.lowercase(Locale.US)) {
        "gpu" -> attempts.add(BackendAttempt("gpu-text", "gpu"))
        "cpu", "cpu-text", "cpu-multimodal" -> attempts.add(BackendAttempt("cpu-text", "cpu"))
        "npu" -> attempts.add(BackendAttempt("npu-text", "npu"))
      }
    }
    attempts.add(BackendAttempt("cpu-text", "cpu"))
    return attempts.distinctBy { it.label }
  }

  private fun isX86Runtime(): Boolean =
    Build.SUPPORTED_ABIS.any { abi ->
      abi.equals("x86", ignoreCase = true) || abi.equals("x86_64", ignoreCase = true)
    }

  private fun replaceRuntime(nextRuntime: LiteRtRuntimeHandle?) {
    val previous = synchronized(lock) {
      val existing = activeRuntime
      activeRuntime = nextRuntime
      existing
    }
    previous?.closeQuietly()
  }

  private fun isLiteRtLmRuntimeAvailable(): Boolean {
    return try {
      LiteRtReflectionClasses.load(reactContext.classLoader)
      true
    } catch (_: ClassNotFoundException) {
      false
    } catch (_: NoSuchMethodException) {
      false
    }
  }

  private fun latestUserMessage(messages: List<BridgeMessage>): String {
    for (index in messages.size - 1 downTo 0) {
      val message = messages[index]
      if (message.role == "user") {
        return message.content.take(MAX_PROMPT_MESSAGE_CHARS).trim()
      }
    }
    return ""
  }

  private fun renderSingleTurnPrompt(messages: List<BridgeMessage>): String {
    val latest = latestUserMessage(messages)
    return if (latest.isBlank()) {
      "Respond with a short SafeRide readiness acknowledgement."
    } else {
      latest.take(MAX_PROMPT_TOTAL_CHARS)
    }
  }

  private fun mockResponse(userMessage: String): String {
    return if (userMessage.isBlank()) {
      "Local AI test mode is loaded."
    } else {
      "Local AI test mode received your message."
    }
  }

  private fun statusMap() = synchronized(lock) {
    Arguments.createMap().apply {
      putString("state", state.name.lowercase(Locale.US))
      putString("modelId", activeModelId)
      putString("manifestId", activeManifestId)
      putBoolean("mockMode", mockMode)
      putBoolean("runtimeAvailable", isLiteRtLmRuntimeAvailable())
      putString("activeBackend", activeBackend)
      putString("backendLabel", activeBackend)
      putBoolean("artifactValidated", artifactValidated)
      putBoolean("realRuntimeLoaded", activeRuntime != null && !mockMode)
      putString("lastErrorCode", lastErrorCode)
      putString("lastErrorMessage", lastErrorMessage)
    }
  }

  private fun clearErrorLocked() {
    lastErrorCode = null
    lastErrorMessage = null
  }

  private fun rejectWithBridgeError(error: BridgeError, promise: Promise) {
    synchronized(lock) {
      lastErrorCode = error.code
      lastErrorMessage = error.safeMessage
    }
    promise.reject(error.code, error.safeMessage)
  }

  private class BridgeError(
    val code: String,
    val safeMessage: String,
    cause: Throwable? = null,
  ) : Exception(safeMessage, cause)

  private data class BackendAttempt(
    val label: String,
    val backend: String,
  )

  private data class GenerationOptions(
    val maxOutputTokens: Int? = null,
    val temperature: Double? = null,
  )

  private class LiteRtRuntimeHandle(
    private val engine: Any,
    private val classes: LiteRtReflectionClasses,
    val backendLabel: String,
  ) {
    @Volatile private var activeConversation: Any? = null

    fun generate(prompt: String, config: BridgeConfig, options: GenerationOptions): String {
      val conversation = classes.createConversation(
        engine = engine,
        systemPrompt = config.systemPrompt,
        temperature = options.temperature ?: DEFAULT_TEMPERATURE,
      )
      activeConversation = conversation
      return try {
        val response = classes.conversationSendMessage.invoke(conversation, prompt, emptyMap<String, Any>())
        response?.toString().orEmpty()
      } catch (error: Throwable) {
        throw unwrapReflectionError(error)
      } finally {
        activeConversation = null
        runCatching { classes.conversationClose.invoke(conversation) }
      }
    }

    fun cancelActiveConversation() {
      val conversation = activeConversation ?: return
      runCatching {
        if (classes.conversationCancelProcess != null) {
          classes.conversationCancelProcess.invoke(conversation)
        } else {
          classes.conversationClose.invoke(conversation)
        }
      }
    }

    fun closeQuietly() {
      cancelActiveConversation()
      runCatching { classes.engineClose.invoke(engine) }
    }
  }

  private class LiteRtReflectionClasses private constructor(
    val engineConstructor: java.lang.reflect.Constructor<*>,
    val engineInitialize: java.lang.reflect.Method,
    val engineClose: java.lang.reflect.Method,
    val engineCreateConversation: java.lang.reflect.Method,
    val conversationClose: java.lang.reflect.Method,
    val conversationSendMessage: java.lang.reflect.Method,
    val conversationCancelProcess: java.lang.reflect.Method?,
    private val backendClass: Class<*>,
    private val cpuBackendClass: Class<*>,
    private val gpuBackendClass: Class<*>,
    private val npuBackendClass: Class<*>,
    private val engineConfigConstructor: java.lang.reflect.Constructor<*>,
    private val conversationConfigConstructor: java.lang.reflect.Constructor<*>,
    private val samplerConfigConstructor: java.lang.reflect.Constructor<*>,
    private val contentsCompanion: Any,
    private val contentsOfText: java.lang.reflect.Method,
  ) {
    fun createBackend(kind: String): Any {
      return when (kind) {
        "gpu" -> gpuBackendClass.getConstructor().newInstance()
        "npu" -> npuBackendClass.getConstructor(String::class.java).newInstance("")
        else -> createCpuBackend()
      }
    }

    private fun createCpuBackend(): Any {
      val nullableInt = Int::class.javaObjectType
      val constructors = listOf(
        arrayOf<Class<*>>(nullableInt),
        emptyArray<Class<*>>(),
        arrayOf<Class<*>>(nullableInt, nullableInt),
      )
      for (signature in constructors) {
        val constructor = runCatching { cpuBackendClass.getConstructor(*signature) }.getOrNull()
          ?: continue
        val args = arrayOfNulls<Any>(signature.size)
        return constructor.newInstance(*args)
      }
      throw NoSuchMethodException("No supported LiteRT-LM CPU backend constructor found.")
    }

    fun createEngineConfig(
      modelPath: String,
      backend: Any,
      visionBackend: Any?,
      audioBackend: Any?,
      maxNumTokens: Int,
      cacheDir: String,
    ): Any {
      return engineConfigConstructor.newInstance(
        modelPath,
        backend,
        visionBackend,
        audioBackend,
        maxNumTokens,
        null,
        cacheDir,
      )
    }

    fun createConversation(engine: Any, systemPrompt: String, temperature: Double): Any {
      val systemInstruction = contentsOfText.invoke(contentsCompanion, systemPrompt)
      val samplerConfig = samplerConfigConstructor.newInstance(10, 0.9, temperature, 0)
      val conversationConfig = conversationConfigConstructor.newInstance(
        systemInstruction,
        emptyList<Any>(),
        emptyList<Any>(),
        samplerConfig,
        false,
        emptyList<Any>(),
        emptyMap<String, Any>(),
        null,
      )
      return engineCreateConversation.invoke(engine, conversationConfig)
    }

    companion object {
      fun load(classLoader: ClassLoader): LiteRtReflectionClasses {
        val packageName = "com.google.ai.edge.litertlm"
        val engineClass = Class.forName("$packageName.Engine", true, classLoader)
        val engineConfigClass = Class.forName("$packageName.EngineConfig", true, classLoader)
        val backendClass = Class.forName("$packageName.Backend", true, classLoader)
        val cpuBackendClass = Class.forName("$packageName.Backend\$CPU", true, classLoader)
        val gpuBackendClass = Class.forName("$packageName.Backend\$GPU", true, classLoader)
        val npuBackendClass = Class.forName("$packageName.Backend\$NPU", true, classLoader)
        val conversationClass = Class.forName("$packageName.Conversation", true, classLoader)
        val conversationConfigClass = Class.forName("$packageName.ConversationConfig", true, classLoader)
        val contentsClass = Class.forName("$packageName.Contents", true, classLoader)
        val samplerConfigClass = Class.forName("$packageName.SamplerConfig", true, classLoader)
        val loraConfigClass = Class.forName("$packageName.LoraConfig", true, classLoader)
        val contentsCompanion: Any = contentsClass.getField("Companion").get(null)
          ?: throw NoSuchFieldException("$packageName.Contents.Companion")

        return LiteRtReflectionClasses(
          engineConstructor = engineClass.getConstructor(engineConfigClass),
          engineInitialize = engineClass.getMethod("initialize"),
          engineClose = engineClass.getMethod("close"),
          engineCreateConversation = engineClass.getMethod("createConversation", conversationConfigClass),
          conversationClose = conversationClass.getMethod("close"),
          conversationSendMessage = conversationClass.getMethod("sendMessage", String::class.java, Map::class.java),
          conversationCancelProcess = conversationClass.methods.firstOrNull { method ->
            method.parameterCount == 0 && method.name in setOf("cancel", "cancelProcess")
          },
          backendClass = backendClass,
          cpuBackendClass = cpuBackendClass,
          gpuBackendClass = gpuBackendClass,
          npuBackendClass = npuBackendClass,
          engineConfigConstructor = engineConfigClass.getConstructor(
            String::class.java,
            backendClass,
            backendClass,
            backendClass,
            Int::class.javaObjectType,
            Int::class.javaObjectType,
            String::class.java,
          ),
          conversationConfigConstructor = conversationConfigClass.getConstructor(
            contentsClass,
            List::class.java,
            List::class.java,
            samplerConfigClass,
            Boolean::class.javaPrimitiveType,
            List::class.java,
            Map::class.java,
            loraConfigClass,
          ),
          samplerConfigConstructor = samplerConfigClass.getConstructor(
            Int::class.javaPrimitiveType,
            Double::class.javaPrimitiveType,
            Double::class.javaPrimitiveType,
            Int::class.javaPrimitiveType,
          ),
          contentsCompanion = contentsCompanion,
          contentsOfText = contentsCompanion.javaClass.getMethod("of", String::class.java),
        )
      }
    }
  }

  private fun ReadableMap.getRequiredString(key: String): String {
    val value = getNullableString(key)?.trim()
    if (value.isNullOrBlank()) {
      throw BridgeError(ERR_INVALID_CONFIG, "Local AI setup is incomplete.")
    }
    return value
  }

  private fun ReadableMap.getNullableString(key: String): String? =
    if (hasKey(key) && !isNull(key)) getString(key) else null

  private fun ReadableMap.getNullableLong(key: String): Long? =
    if (hasKey(key) && !isNull(key)) getDouble(key).toLong() else null

  private fun ReadableMap.getNullableStringArray(key: String): List<String> {
    if (!hasKey(key) || isNull(key)) return emptyList()
    val array = getArray(key) ?: return emptyList()
    val values = mutableListOf<String>()
    for (index in 0 until array.size()) {
      val value = array.getString(index)?.trim()
      if (!value.isNullOrBlank()) {
        values.add(value)
      }
    }
    return values
  }

  companion object {
    const val NAME = "SafeRideLiteRtLm"
    private val SHA256_PATTERN = Regex("^[a-f0-9]{64}$")
    private val SAFE_PATH_SEGMENT_PATTERN = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$")
    private const val MAX_IDENTITY_CHARS = 200
    private val APPROVED_ARTIFACT_BINDINGS = listOf(
      ApprovedArtifactBinding(
        modelId = "litert-community/gemma-4-E2B-it-litert-lm",
        manifestId = "litert-community-gemma-4-e2b-litertlm-prototype-2026-06-29.1",
        fileName = "gemma-4-E2B-it.litertlm",
        sizeBytes = 2_588_147_712L,
        sha256 = "181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c",
      ),
      ApprovedArtifactBinding(
        modelId = "esherialabs/saferide-gemma-4-e2b-v058-original-419806-litertlm",
        manifestId = "saferide-gemma4-e2b-v058-original-419806-litertlm-artifact-produced-2026-08-10.1",
        fileName = "saferide-gemma4-e2b-v058-original-419806-runtime-compatible.litertlm",
        sizeBytes = 5_071_837_136L,
        sha256 = "8b73fd844464f220955eeedc474c30f39e621458c7a6b092de5afa2c3d027fcd",
      ),
    )
    private const val DEFAULT_SYSTEM_PROMPT =
      "You are the SafeRide on-device assistant. Keep answers concise, survivor-centred, practical, and cautious. Do not claim to be a lawyer, clinician, counsellor, police officer, emergency responder, or UNICEF representative. Do not invent facts."
    private const val DEFAULT_TEMPERATURE = 0.2
    private const val HASH_BUFFER_SIZE = 1024 * 1024
    private const val LOG_TAG = "SafeRideLiteRtLm"
    private const val MAX_DIAGNOSTIC_MESSAGE_CHARS = 500
    private const val MAX_PROMPT_MESSAGES = 8
    private const val MAX_PROMPT_MESSAGE_CHARS = 1200
    private const val MAX_PROMPT_TOTAL_CHARS = 8000
    private const val ERR_INVALID_CONFIG = "ERR_LITERT_INVALID_CONFIG"
    private const val ERR_UNSUPPORTED_MANIFEST = "ERR_LITERT_UNSUPPORTED_MANIFEST"
    private const val ERR_INVALID_MODEL_PATH = "ERR_LITERT_INVALID_MODEL_PATH"
    private const val ERR_MODEL_PATH_OUTSIDE_APP_STORAGE = "ERR_LITERT_MODEL_PATH_OUTSIDE_APP_STORAGE"
    private const val ERR_MODEL_FILE_MISSING = "ERR_LITERT_MODEL_FILE_MISSING"
    private const val ERR_MODEL_SIZE_MISMATCH = "ERR_LITERT_MODEL_SIZE_MISMATCH"
    private const val ERR_CHECKSUM_MISMATCH = "ERR_LITERT_CHECKSUM_MISMATCH"
    private const val ERR_REAL_RUNTIME_DISABLED = "ERR_LITERT_REAL_RUNTIME_DISABLED"
    private const val ERR_RUNTIME_UNAVAILABLE = "ERR_LITERT_RUNTIME_UNAVAILABLE"
    private const val ERR_LOAD_FAILED = "ERR_LITERT_LOAD_FAILED"
    private const val ERR_INIT_FAILED = "ERR_LITERT_INIT_FAILED"
    private const val ERR_NOT_LOADED = "ERR_LITERT_NOT_LOADED"
    private const val ERR_EMPTY_RESPONSE = "ERR_LITERT_EMPTY_RESPONSE"
    private const val ERR_GENERATE_FAILED = "ERR_LITERT_GENERATE_FAILED"
    private const val ERR_CANCELLED = "ERR_LITERT_CANCELLED"

    private fun unwrapReflectionError(error: Throwable): Throwable =
      if (error is InvocationTargetException && error.targetException != null) {
        error.targetException
      } else {
        error
      }
  }
}
