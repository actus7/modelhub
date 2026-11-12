import { handleAppRoute } from "@/server/route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export {
  handleAppRoute as DELETE,
  handleAppRoute as GET,
  handleAppRoute as HEAD,
  handleAppRoute as OPTIONS,
  handleAppRoute as PATCH,
  handleAppRoute as POST,
  handleAppRoute as PUT,
};
