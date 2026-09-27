/** Fleet list `issue` filter (PRD FL-2): any / none, or one kind of open exception. Pure, so the API schema can use it. */
export const FLEET_ISSUE_FILTERS = ["any", "none", "incident", "maintenance", "cleaning", "charging", "other"] as const;
export type FleetIssueFilter = (typeof FLEET_ISSUE_FILTERS)[number];
