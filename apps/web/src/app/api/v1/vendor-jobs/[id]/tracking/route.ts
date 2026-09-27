import { apiRoute, ApiProblem } from "@/lib/api/handler";
import { getVendorTracking, postVendorTracking } from "@/lib/api/operations";

export const dynamic = "force-dynamic";

/**
 * Preview `vendor_tracking`. No org has this capability yet (vendor jobs arrive in task 5.5), so apiRoute
 * answers 501 before these run; they exist so the contract and the capability gate cover the route.
 */
const unreachable = async (): Promise<never> => {
  throw new ApiProblem("capability_unavailable", "Vendor tracking isn't available yet.");
};
export const GET = apiRoute(getVendorTracking, unreachable);
export const POST = apiRoute(postVendorTracking, unreachable);
