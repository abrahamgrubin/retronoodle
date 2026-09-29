import { startsApi, startsWorker, type ProcessRole } from '@retronoodle/shared';

export interface Stoppable {
  stop(): Promise<void>;
}

export interface ProcessDeps {
  startApi(): Promise<Stoppable>;
  startWorker(): Promise<Stoppable>;
}

export interface StartedProcess {
  api: Stoppable | null;
  worker: Stoppable | null;
  stop(): Promise<void>;
}

/** Starts the services a ROLE asks for (Design 11.1). */
export async function startProcess(role: ProcessRole, deps: ProcessDeps): Promise<StartedProcess> {
  const worker = startsWorker(role) ? await deps.startWorker() : null;
  const api = startsApi(role) ? await deps.startApi() : null;

  return {
    api,
    worker,
    async stop() {
      await api?.stop();
      await worker?.stop();
    },
  };
}
