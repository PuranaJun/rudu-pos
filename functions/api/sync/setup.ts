import { handleSetup, type Env } from '../../../server/sync.ts';

/** `/api/sync/setup` — see server/sync.ts. */
export const onRequestPost = (context: { env: Env; request: Request }): Promise<Response> =>
  handleSetup(context.env, context.request);
