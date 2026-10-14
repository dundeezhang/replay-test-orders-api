export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type Fields = Record<string, unknown>;

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(message: string, fields?: Fields): void;
  info(message: string, fields?: Fields): void;
  warn(message: string, fields?: Fields): void;
  error(message: string, fields?: Fields): void;
  child(bindings: Fields): Logger;
}

export type LogSink = (line: string) => void;

const stdoutSink: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

export function createLogger(
  level: LogLevel = 'info',
  bindings: Fields = {},
  sink: LogSink = stdoutSink,
): Logger {
  const threshold = LEVEL_ORDER[level];

  const write = (lineLevel: LogLevel, message: string, fields?: Fields): void => {
    if (LEVEL_ORDER[lineLevel] < threshold) {
      return;
    }
    sink(
      JSON.stringify({
        level: lineLevel,
        time: new Date().toISOString(),
        msg: message,
        ...bindings,
        ...fields,
      }),
    );
  };

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: (extra) => createLogger(level, { ...bindings, ...extra }, sink),
  };
}

export const silentLogger: Logger = createLogger('error', {}, () => undefined);
