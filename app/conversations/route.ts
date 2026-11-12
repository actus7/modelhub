import { handleAppRoute } from "@/server/route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export { handleAppRoute as GET, handleAppRoute as OPTIONS, handleAppRoute as POST };
