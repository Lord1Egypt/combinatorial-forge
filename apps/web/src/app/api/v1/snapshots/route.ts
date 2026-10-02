import { context } from "@/lib/context";
import { cached, route } from "@/lib/http";
import { listSnapshots } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export const GET = route(async () => cached({ snapshots: await listSnapshots((await context()).db) }, 60));
