import { apiRoute } from "@/lib/api/handler";
import { uuidParam } from "@/lib/api/cursor";
import { getExceptionById, patchException } from "@/lib/api/operations";
import { getException, getExceptionOut, updateException } from "@/lib/services/exceptions";

export const dynamic = "force-dynamic";

/** One exception with what triggered it and its history. */
export const GET = apiRoute(getExceptionById, async ({ db, org, params }) => ({
  body: await getException(db, org, uuidParam(params)),
}));

/** Assign, start, resolve, dismiss or reopen, with an optional note in the history (owner / admin / ops). */
export const PATCH = apiRoute(patchException, async ({ db, org, params, body }) => {
  const id = uuidParam(params);
  await updateException(db, org, id, body);
  return { body: await getExceptionOut(db, org, id) };
});
