type RequestLogShape = {
  id?: string;
  method?: string;
};

type ResponseLogShape = {
  statusCode?: number;
};

type ErrorLogShape = {
  name?: string;
  code?: string;
  statusCode?: number;
};

export const privacySafeSerializers = {
  req(request: RequestLogShape) {
    return {
      id: request.id,
      method: request.method,
    };
  },
  res(response: ResponseLogShape) {
    return {
      statusCode: response.statusCode,
    };
  },
  err(error: ErrorLogShape) {
    return {
      type: error.name ?? 'Error',
      message: '[redacted]',
      stack: '[redacted]',
      code: error.code,
      statusCode: error.statusCode,
    };
  },
};
