/**
 * AppError — typed HTTP error that flows through Express error middleware.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly error: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static badRequest(message: string) {
    return new AppError(400, 'Bad Request', message);
  }

  static notFound(message: string) {
    return new AppError(404, 'Not Found', message);
  }

  static unsupportedMedia(message: string) {
    return new AppError(415, 'Unsupported Media Type', message);
  }

  static payloadTooLarge(message: string) {
    return new AppError(413, 'Payload Too Large', message);
  }

  static internal(message: string) {
    return new AppError(500, 'Internal Server Error', message);
  }
}
