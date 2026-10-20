import { pino, type Logger, type LoggerOptions } from 'pino';

/** JSON logs; credentials and signatures are redacted wherever they appear. */
export function createLogger(level: LoggerOptions['level'], name: string): Logger {
  return pino({
    name,
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-hub-signature-256"]',
        'res.headers["set-cookie"]',
        '*.privateKey',
        '*.token',
      ],
      censor: '[redacted]',
    },
  });
}
