import { handleCheck, type Env } from '../../../server/sync.ts';

/** `/api/sync/check` — see server/sync.ts. */
export const onRequestGet = (context: { env: Env; request: Request }): Promise<Response> =>
  handleCheck(context.env, context.request);
