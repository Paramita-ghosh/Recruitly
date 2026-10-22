export const validate =
  (schema, source = 'body') =>
  (req, _res, next) => {
    const r = schema.safeParse(req[source]);
    if (!r.success) return next(r.error);
    req[source] = r.data;
    next();
  };
