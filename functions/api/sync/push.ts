import { handlePush, type Env } from '../../../server/sync.ts';

/** `/api/sync/push` — see server/sync.ts. */
export const onRequestPost = (context: { env: Env; request: Request }): Promise<Response> =>
  handlePush(context.env, context.request);
