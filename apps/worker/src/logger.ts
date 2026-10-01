export interface WorkerLogger {
  info(msg: string): void;
  error(obj: unknown, msg: string): void;
}
