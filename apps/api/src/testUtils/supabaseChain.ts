/** A minimal chainable stub for one `.from(table)` call in tests. `terminal` resolves whatever
 * the handler ultimately awaits (`.single()`, `.maybeSingle()`, or the builder itself). Every
 * other method (`.select`, `.eq`, `.in`, `.insert`, `.update`, `.upsert`, `.delete`) just
 * records its call and returns the same chain, matching how far route handlers actually chain
 * each query — this isn't a real query builder, just enough surface to drive a route once. */
export function chain(terminal: { data?: unknown; error?: unknown }, calls: unknown[][] = []) {
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return api;
    };
  const api = {
    select: record('select'),
    eq: record('eq'),
    in: record('in'),
    or: record('or'),
    order: record('order'),
    limit: record('limit'),
    insert: record('insert'),
    update: record('update'),
    upsert: record('upsert'),
    delete: record('delete'),
    async single() {
      return terminal;
    },
    async maybeSingle() {
      return terminal;
    },
    then(resolve: (v: typeof terminal) => unknown) {
      return Promise.resolve(resolve(terminal));
    },
  };
  return api;
}
