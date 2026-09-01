/** Bungkus handler async supaya error-nya sampai ke error middleware Express 4. */
export const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

export default asyncHandler;
