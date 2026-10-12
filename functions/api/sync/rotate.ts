import { handleRotate, type Env } from '../../../server/sync.ts';

/** `/api/sync/rotate` — see server/sync.ts. */
export const onRequestPost = (context: { env: Env; request: Request }): Promise<Response> =>
  handleRotate(context.env, context.request);
