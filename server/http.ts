import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const bad = (msg: string) => new HttpError(400, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const forbidden = (msg = 'You do not have access to this') => new HttpError(403, msg);

/** Wraps an async route so thrown errors reach the error handler. */
export const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  return schema.parse(data);
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return res.status(400).json({ error: `${first.path.join('.') || 'input'}: ${first.message}` });
  }
  if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.too.large') {
    return res.status(413).json({ error: 'File is too large (25 MB limit)' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
}

/** Serves a binary with HTTP Range support, which Safari needs for <video>. */
export function sendMedia(req: Request, res: Response, data: Buffer, mime: string) {
  const size = data.length;
  res.setHeader('Content-Type', mime);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start = m[1] ? Number(m[1]) : 0;
      let end = m[2] ? Number(m[2]) : size - 1;
      if (!m[1] && m[2]) {
        start = size - Number(m[2]);
        end = size - 1;
      }
      if (start >= size || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${size}`);
        return res.end();
      }
      end = Math.min(end, size - 1);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      return res.end(data.subarray(start, end + 1));
    }
  }
  res.setHeader('Content-Length', String(size));
  res.end(data);
}

export const toBuffer = (v: unknown): Buffer | null => {
  if (!v) return null;
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Uint8Array) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  return null;
};

export const ms = (v: unknown): number => (v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : Number(v));
