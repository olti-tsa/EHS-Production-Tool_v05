import type { Response } from "express";
import { sql } from "drizzle-orm";
import {
  db,
  pool,
  projectBriefsTable,
} from "@workspace/db";
import type { PoolClient } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const CHANNEL = "portal_crew_response";
const MAX_SUBSCRIBERS = 2000;

type Subscriber = { userId: string; response: Response };

const subscribers = new Set<Subscriber>();
let listenerClient: PoolClient | null = null;
let listenerPromise: Promise<void> | null = null;
let listenerGeneration = 0;

function writeEvent(response: Response, event: string, data: unknown): boolean {
  try {
    return response.write(
      `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    );
  } catch {
    return false;
  }
}

async function broadcast(briefId: string): Promise<void> {
  const [brief] = await db
    .select({ ownerUserId: projectBriefsTable.ownerUserId })
    .from(projectBriefsTable)
    .where(eq(projectBriefsTable.id, briefId))
    .limit(1);
  if (!brief) return;
  for (const subscriber of [...subscribers]) {
    if (subscriber.userId !== brief.ownerUserId) continue;
    if (!writeEvent(subscriber.response, "crew-response", { briefId })) {
      unsubscribe(subscriber);
    }
  }
}

async function ensureListener(): Promise<void> {
  if (listenerClient) return;
  if (listenerPromise) return listenerPromise;
  const generation = ++listenerGeneration;
  listenerPromise = (async () => {
    const client = (await pool.connect()) as unknown as PoolClient;
    const onNotification = (message: { channel?: string; payload?: string }) => {
      if (message.channel !== CHANNEL || !message.payload) return;
      try {
        const payload = JSON.parse(message.payload) as { briefId?: unknown };
        if (typeof payload.briefId === "string" && payload.briefId) {
          void broadcast(payload.briefId).catch((error: unknown) =>
            logger.error(
              { err: error instanceof Error ? error.message : String(error) },
              "crew response broadcast failed",
            ),
          );
        }
      } catch {
        logger.warn("Ignoring malformed crew response notification");
      }
    };
    const onError = (error: Error) => {
      if (listenerClient !== client) return;
      listenerClient = null;
      listenerGeneration += 1;
      // Do not leave connected clients silently waiting after LISTEN fails.
      // A bounded stream lifetime and this close force the frontend to
      // reconnect and re-authenticate rather than trusting a dead listener.
      for (const subscriber of [...subscribers]) {
        subscribers.delete(subscriber);
        subscriber.response.end();
      }
      client.release(true);
      logger.error({ err: error }, "crew response listener failed");
    };
    client.on("notification", onNotification);
    client.on("error", onError);
    try {
      await client.query(`LISTEN ${CHANNEL}`);
    } catch (error) {
      client.release(true);
      throw error;
    }
    if (generation !== listenerGeneration || subscribers.size === 0) {
      await client.query(`UNLISTEN ${CHANNEL}`).catch(() => undefined);
      client.release();
      return;
    }
    listenerClient = client;
  })().finally(() => {
    listenerPromise = null;
  });
  return listenerPromise;
}

function unsubscribe(subscriber: Subscriber): void {
  if (!subscribers.delete(subscriber)) return;
  subscriber.response.end();
  if (subscribers.size === 0 && listenerClient) {
    const client = listenerClient;
    listenerClient = null;
    listenerGeneration += 1;
    void client
      .query(`UNLISTEN ${CHANNEL}`)
      .catch(() => undefined)
      .finally(() => client.release());
  }
}

export async function subscribeCrewResponses(
  userId: string,
  response: Response,
): Promise<() => void> {
  if (subscribers.size >= MAX_SUBSCRIBERS) {
    throw new Error("Crew response stream capacity reached.");
  }
  const subscriber: Subscriber = { userId, response };
  subscribers.add(subscriber);
  try {
    await ensureListener();
    return () => unsubscribe(subscriber);
  } catch (error) {
    unsubscribe(subscriber);
    throw error;
  }
}

/** Emit only the public brief identifier. Callers invoke this after their
 * mutation transaction has committed. */
export async function notifyCrewResponse(briefId: string): Promise<void> {
  await db.execute(
    sql`select pg_notify(${CHANNEL}, ${JSON.stringify({ briefId })})`,
  );
}
