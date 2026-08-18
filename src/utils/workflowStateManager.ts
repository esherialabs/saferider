import { encryptedAsyncStorage } from '../lib/encryptedAsyncStorage';
import { errorHandler, ErrorCategory, ErrorSeverity } from './errorHandling';

export enum WorkflowType {
  INCIDENT_REPORTING = 'incident_reporting',
  CASE_MANAGEMENT = 'case_management',
  SHARING_WORKFLOW = 'sharing_workflow',
  ONBOARDING = 'onboarding',
  SETTINGS_CONFIGURATION = 'settings_configuration',
}

export enum WorkflowStatus {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface WorkflowStep {
  id: string;
  name: string;
  description?: string;
  required: boolean;
  dependencies?: string[];
  validationRules?: ValidationRule[];
  data?: Record<string, any>;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  startedAt?: Date;
  completedAt?: Date;
  errors?: string[];
}

export interface ValidationRule {
  field: string;
  type: 'required' | 'minLength' | 'maxLength' | 'pattern' | 'custom';
  value?: any;
  message: string;
  validator?: (value: any, context: any) => boolean;
}

export interface WorkflowState {
  id: string;
  type: WorkflowType;
  status: WorkflowStatus;
  currentStepId?: string;
  steps: Record<string, WorkflowStep>;
  stepOrder: string[];
  data: Record<string, any>;
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    progress: number; // 0-100
    version: string;
  };
  config: {
    allowSkipping: boolean;
    saveOnEachStep: boolean;
    autoAdvance: boolean;
    timeoutMinutes?: number;
  };
}

export interface WorkflowTransition {
  from: string;
  to: string;
  condition?: (state: WorkflowState) => boolean;
  action?: (state: WorkflowState) => Promise<void>;
}

class WorkflowStateManager {
  private workflows: Map<string, WorkflowState> = new Map();
  private listeners: Map<string, Array<(state: WorkflowState) => void>> = new Map();
  private transitions: Map<WorkflowType, WorkflowTransition[]> = new Map();

  constructor() {
    this.setupDefaultTransitions();
    this.loadWorkflows();
  }

  // Workflow lifecycle management
  public async createWorkflow(
    type: WorkflowType,
    steps: Omit<WorkflowStep, 'status' | 'startedAt' | 'completedAt' | 'errors'>[],
    config: Partial<WorkflowState['config']> = {}
  ): Promise<string> {
    const workflowId = this.generateWorkflowId(type);
    
    const stepOrder = steps.map(step => step.id);
    const stepsMap = steps.reduce((acc, step) => {
      acc[step.id] = {
        ...step,
        status: 'pending' as const,
        errors: [],
      };
      return acc;
    }, {} as Record<string, WorkflowStep>);

    const workflow: WorkflowState = {
      id: workflowId,
      type,
      status: WorkflowStatus.NOT_STARTED,
      steps: stepsMap,
      stepOrder,
      data: {},
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        progress: 0,
        version: '1.0',
      },
      config: {
        allowSkipping: false,
        saveOnEachStep: true,
        autoAdvance: true,
        ...config,
      },
    };

    this.workflows.set(workflowId, workflow);
    await this.saveWorkflow(workflow);
    
    return workflowId;
  }

  public async startWorkflow(workflowId: string): Promise<boolean> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    if (workflow.status !== WorkflowStatus.NOT_STARTED && workflow.status !== WorkflowStatus.PAUSED) {
      throw new Error(`Cannot start workflow in status: ${workflow.status}`);
    }

    workflow.status = WorkflowStatus.IN_PROGRESS;
    workflow.metadata.startedAt = new Date();
    workflow.metadata.updatedAt = new Date();

    // Start with first step if no current step
    if (!workflow.currentStepId && workflow.stepOrder.length > 0) {
      workflow.currentStepId = workflow.stepOrder[0];
      workflow.steps[workflow.currentStepId].status = 'in_progress';
      workflow.steps[workflow.currentStepId].startedAt = new Date();
    }

    await this.updateWorkflow(workflow);
    return true;
  }

  public async pauseWorkflow(workflowId: string): Promise<boolean> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    workflow.status = WorkflowStatus.PAUSED;
    workflow.metadata.updatedAt = new Date();

    await this.updateWorkflow(workflow);
    return true;
  }

  public async cancelWorkflow(workflowId: string): Promise<boolean> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    workflow.status = WorkflowStatus.CANCELLED;
    workflow.metadata.updatedAt = new Date();

    await this.updateWorkflow(workflow);
    return true;
  }

  // Step management
  public async completeStep(
    workflowId: string,
    stepId: string,
    data?: Record<string, any>
  ): Promise<boolean> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const step = workflow.steps[stepId];
    if (!step) {
      throw new Error(`Step ${stepId} not found in workflow ${workflowId}`);
    }

    // Validate step data
    if (data) {
      const validationResult = await this.validateStepData(step, data, workflow);
      if (!validationResult.isValid) {
        step.errors = validationResult.errors;
        await this.updateWorkflow(workflow);
        return false;
      }
    }

    // Complete the step
    step.status = 'completed';
    step.completedAt = new Date();
    step.errors = [];
    
    if (data) {
      step.data = { ...step.data, ...data };
      workflow.data = { ...workflow.data, ...data };
    }

    // Auto-advance to next step if configured
    if (workflow.config.autoAdvance) {
      const nextStepId = this.getNextStepId(workflow, stepId);
      if (nextStepId) {
        workflow.currentStepId = nextStepId;
        workflow.steps[nextStepId].status = 'in_progress';
        workflow.steps[nextStepId].startedAt = new Date();
      } else {
        // No more steps - complete workflow
        workflow.status = WorkflowStatus.COMPLETED;
        workflow.metadata.completedAt = new Date();
      }
    }

    // Update progress
    workflow.metadata.progress = this.calculateProgress(workflow);
    workflow.metadata.updatedAt = new Date();

    await this.updateWorkflow(workflow);
    return true;
  }

  public async skipStep(workflowId: string, stepId: string): Promise<boolean> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow || !workflow.config.allowSkipping) {
      return false;
    }

    const step = workflow.steps[stepId];
    if (!step || step.required) {
      return false;
    }

    step.status = 'skipped';
    
    if (workflow.config.autoAdvance) {
      const nextStepId = this.getNextStepId(workflow, stepId);
      if (nextStepId) {
        workflow.currentStepId = nextStepId;
        workflow.steps[nextStepId].status = 'in_progress';
        workflow.steps[nextStepId].startedAt = new Date();
      }
    }

    workflow.metadata.progress = this.calculateProgress(workflow);
    workflow.metadata.updatedAt = new Date();

    await this.updateWorkflow(workflow);
    return true;
  }

  public async failStep(
    workflowId: string,
    stepId: string,
    error: string
  ): Promise<boolean> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const step = workflow.steps[stepId];
    if (!step) {
      throw new Error(`Step ${stepId} not found in workflow ${workflowId}`);
    }

    step.status = 'failed';
    step.errors = step.errors || [];
    step.errors.push(error);

    workflow.metadata.updatedAt = new Date();

    await this.updateWorkflow(workflow);
    return true;
  }

  public async goToStep(workflowId: string, stepId: string): Promise<boolean> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    if (!workflow.steps[stepId]) {
      throw new Error(`Step ${stepId} not found in workflow ${workflowId}`);
    }

    // Check dependencies
    const canNavigate = await this.canNavigateToStep(workflow, stepId);
    if (!canNavigate) {
      return false;
    }

    // Update current step
    if (workflow.currentStepId && workflow.currentStepId !== stepId) {
      const currentStep = workflow.steps[workflow.currentStepId];
      if (currentStep.status === 'in_progress') {
        currentStep.status = 'pending';
      }
    }

    workflow.currentStepId = stepId;
    workflow.steps[stepId].status = 'in_progress';
    workflow.steps[stepId].startedAt = new Date();
    workflow.metadata.updatedAt = new Date();

    await this.updateWorkflow(workflow);
    return true;
  }

  // Data management
  public async updateWorkflowData(
    workflowId: string,
    data: Record<string, any>
  ): Promise<boolean> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    workflow.data = { ...workflow.data, ...data };
    workflow.metadata.updatedAt = new Date();

    await this.updateWorkflow(workflow);
    return true;
  }

  public getWorkflowData(workflowId: string): Record<string, any> | null {
    const workflow = this.workflows.get(workflowId);
    return workflow ? workflow.data : null;
  }

  public getStepData(workflowId: string, stepId: string): Record<string, any> | null {
    const workflow = this.workflows.get(workflowId);
    if (!workflow || !workflow.steps[stepId]) {
      return null;
    }
    return workflow.steps[stepId].data || {};
  }

  // Query methods
  public getWorkflow(workflowId: string): WorkflowState | null {
    return this.workflows.get(workflowId) || null;
  }

  public getWorkflowsByType(type: WorkflowType): WorkflowState[] {
    return Array.from(this.workflows.values()).filter(w => w.type === type);
  }

  public getWorkflowsByStatus(status: WorkflowStatus): WorkflowState[] {
    return Array.from(this.workflows.values()).filter(w => w.status === status);
  }

  public getCurrentStep(workflowId: string): WorkflowStep | null {
    const workflow = this.workflows.get(workflowId);
    if (!workflow || !workflow.currentStepId) {
      return null;
    }
    return workflow.steps[workflow.currentStepId];
  }

  public getProgress(workflowId: string): number {
    const workflow = this.workflows.get(workflowId);
    return workflow ? workflow.metadata.progress : 0;
  }

  // Event listeners
  public addWorkflowListener(
    workflowId: string,
    listener: (state: WorkflowState) => void
  ): () => void {
    if (!this.listeners.has(workflowId)) {
      this.listeners.set(workflowId, []);
    }
    
    this.listeners.get(workflowId)!.push(listener);
    
    return () => {
      const listeners = this.listeners.get(workflowId);
      if (listeners) {
        const index = listeners.indexOf(listener);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    };
  }

  // Private helper methods
  private async validateStepData(
    step: WorkflowStep,
    data: Record<string, any>,
    workflow: WorkflowState
  ): Promise<{ isValid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!step.validationRules) {
      return { isValid: true, errors };
    }

    for (const rule of step.validationRules) {
      const value = data[rule.field];
      let isValid = true;

      switch (rule.type) {
        case 'required':
          isValid = value !== undefined && value !== null && value !== '';
          break;
        case 'minLength':
          isValid = typeof value === 'string' && value.length >= rule.value;
          break;
        case 'maxLength':
          isValid = typeof value === 'string' && value.length <= rule.value;
          break;
        case 'pattern':
          isValid = typeof value === 'string' && new RegExp(rule.value).test(value);
          break;
        case 'custom':
          isValid = rule.validator ? rule.validator(value, { data, workflow }) : true;
          break;
      }

      if (!isValid) {
        errors.push(rule.message);
      }
    }

    return { isValid: errors.length === 0, errors };
  }

  private getNextStepId(workflow: WorkflowState, currentStepId: string): string | null {
    const currentIndex = workflow.stepOrder.indexOf(currentStepId);
    if (currentIndex === -1 || currentIndex === workflow.stepOrder.length - 1) {
      return null;
    }
    return workflow.stepOrder[currentIndex + 1];
  }

  private async canNavigateToStep(workflow: WorkflowState, stepId: string): Promise<boolean> {
    const step = workflow.steps[stepId];
    if (!step.dependencies) {
      return true;
    }

    // Check if all dependencies are completed
    for (const depId of step.dependencies) {
      const depStep = workflow.steps[depId];
      if (!depStep || depStep.status !== 'completed') {
        return false;
      }
    }

    return true;
  }

  private calculateProgress(workflow: WorkflowState): number {
    const totalSteps = workflow.stepOrder.length;
    if (totalSteps === 0) return 100;

    const completedSteps = Object.values(workflow.steps).filter(
      step => step.status === 'completed'
    ).length;

    return Math.round((completedSteps / totalSteps) * 100);
  }

  private async updateWorkflow(workflow: WorkflowState): Promise<void> {
    this.workflows.set(workflow.id, workflow);
    
    if (workflow.config.saveOnEachStep) {
      await this.saveWorkflow(workflow);
    }

    this.notifyListeners(workflow);
  }

  private notifyListeners(workflow: WorkflowState): void {
    const listeners = this.listeners.get(workflow.id);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(workflow);
        } catch (error) {
          console.error('Workflow listener error:', error);
        }
      });
    }
  }

  private generateWorkflowId(type: WorkflowType): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 6);
    return `${type}_${timestamp}_${random}`;
  }

  private async saveWorkflow(workflow: WorkflowState): Promise<void> {
    try {
      await encryptedAsyncStorage.setItem(`@workflow_${workflow.id}`, JSON.stringify(workflow));
    } catch (error) {
      await errorHandler.handleError(
        error as Error,
        ErrorCategory.STORAGE,
        ErrorSeverity.MEDIUM,
        { showAlert: false }
      );
    }
  }

  public async rehydrateFromStorage(): Promise<void> {
    await this.loadWorkflows({ replace: true, throwOnFailure: true });
    this.workflows.forEach(workflow => this.notifyListeners(workflow));
  }

  private async loadWorkflows(options: { replace?: boolean; throwOnFailure?: boolean } = {}): Promise<void> {
    try {
      const keys = await encryptedAsyncStorage.getAllKeys();
      const workflowKeys = keys.filter(key => key.startsWith('@workflow_'));
      const loadedWorkflows = new Map<string, WorkflowState>();
      
      for (const key of workflowKeys) {
        const data = await encryptedAsyncStorage.getItem(key);
        if (data) {
          const workflow = JSON.parse(data);
          // Convert date strings back to Date objects
          workflow.metadata.createdAt = new Date(workflow.metadata.createdAt);
          workflow.metadata.updatedAt = new Date(workflow.metadata.updatedAt);
          if (workflow.metadata.startedAt) {
            workflow.metadata.startedAt = new Date(workflow.metadata.startedAt);
          }
          if (workflow.metadata.completedAt) {
            workflow.metadata.completedAt = new Date(workflow.metadata.completedAt);
          }
          
          // Convert step dates
          Object.values(workflow.steps).forEach((step: any) => {
            if (step.startedAt) step.startedAt = new Date(step.startedAt);
            if (step.completedAt) step.completedAt = new Date(step.completedAt);
          });
          
          loadedWorkflows.set(workflow.id, workflow);
        }
      }

      if (options.replace) {
        this.workflows = loadedWorkflows;
      } else {
        loadedWorkflows.forEach((workflow, id) => {
          this.workflows.set(id, workflow);
        });
      }
    } catch (error) {
      console.error('Failed to load workflows:', error);
      if (options.throwOnFailure) {
        throw error;
      }
    }
  }

  private setupDefaultTransitions(): void {
    // Define workflow-specific transitions
    this.transitions.set(WorkflowType.INCIDENT_REPORTING, [
      {
        from: 'what_happened',
        to: 'where_when',
        condition: (state) => !!state.data.description || (state.data.tags && state.data.tags.length > 0),
      },
      {
        from: 'where_when',
        to: 'evidence_detail',
        condition: (state) => !!state.data.location && !!state.data.datetime,
      },
      {
        from: 'evidence_detail',
        to: 'legal_framing',
        condition: (state) => true, // Evidence is optional
      },
      {
        from: 'legal_framing',
        to: 'pathway_selection',
        condition: (state) => state.data.selectedTags && state.data.selectedTags.length > 0,
      },
    ]);
  }

  public async deleteWorkflow(workflowId: string): Promise<boolean> {
    try {
      this.workflows.delete(workflowId);
      this.listeners.delete(workflowId);
      await encryptedAsyncStorage.removeItem(`@workflow_${workflowId}`);
      return true;
    } catch (error) {
      console.error('Failed to delete workflow:', error);
      return false;
    }
  }
}

// Export singleton instance
export const workflowManager = new WorkflowStateManager();

// Convenience functions
export const createWorkflow = workflowManager.createWorkflow.bind(workflowManager);
export const startWorkflow = workflowManager.startWorkflow.bind(workflowManager);
export const completeStep = workflowManager.completeStep.bind(workflowManager);
export const getWorkflow = workflowManager.getWorkflow.bind(workflowManager);
export const getCurrentStep = workflowManager.getCurrentStep.bind(workflowManager);
