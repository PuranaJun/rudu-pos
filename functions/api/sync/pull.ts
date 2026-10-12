import { handlePull, type Env } from '../../../server/sync.ts';

/** `/api/sync/pull` — see server/sync.ts. */
export const onRequestGet = (context: { env: Env; request: Request }): Promise<Response> =>
  handlePull(context.env, context.request);
