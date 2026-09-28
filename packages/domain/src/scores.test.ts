import {
  performanceLabel,
  lineFlag,
  zScores,
  anomalies,
  mainDrivers,
  assetHealthGrade,
  gradeLetter,
  covenantStatus,
} from "./scores";

describe("performanceLabel", () => {
  it("MVP 047 (margin far below fleet, availability 81%) → review", () =>
    expect(
      performanceLabel({ margin: 0.268, fleetAvgMargin: 0.528, availability: 0.81, availabilityTarget: 0.92 }),
    ).toBe("review"));
  it("MVP 031 (58% margin, 95.1% availability) → strong", () =>
    expect(
      performanceLabel({ margin: 0.58, fleetAvgMargin: 0.528, availability: 0.951, availabilityTarget: 0.92 }),
    ).toBe("strong"));
  it("in between → monitor", () =>
    expect(performanceLabel({ margin: 0.5, fleetAvgMargin: 0.528, availability: 0.9, availabilityTarget: 0.92 })).toBe(
      "monitor",
    ));
});

describe("lineFlag", () => {
  it("flags cleaning 38% above average", () => expect(lineFlag(1.38, 1)).toBeCloseTo(0.38));
  it("doesn't flag 20% above", () => expect(lineFlag(1.2, 1)).toBeNull());
  it("ignores a zero average", () => expect(lineFlag(5, 0)).toBeNull());
});

describe("anomalies", () => {
  it("finds the cohort outlier", () => expect(anomalies([0.55, 0.53, 0.56, 0.54, 0.27, 0.55])).toEqual([4]));
  it("zero spread → no anomalies", () => expect(zScores([0.5, 0.5, 0.5])).toEqual([0, 0, 0]));
  it("single value → z 0", () => expect(zScores([1])).toEqual([0]));
  it("main drivers explain ≥ 70% of the gap", () =>
    expect(mainDrivers({ cleaning: 350, downtime: 140, maintenance: 50, electricity: -20 })).toEqual([
      "cleaning",
      "downtime",
    ]));
});

describe("assetHealthGrade", () => {
  const mvpAugust = {
    uptime: 0.972,
    uptimeCovenant: 0.94,
    contributionMargin: 0.541,
    marginTarget: 0.5,
    reserveFunded: 1.18,
    incidentsPer10k: 2.1,
    incidentTargetPer10k: 2.5,
    vendorSla: 0.93,
  };
  it("MVP August figures grade A (the MVP showed A−, illustrative)", () => {
    const g = assetHealthGrade(mvpAugust);
    expect(g.score).toBeCloseTo(98, 0);
    expect(g.letter).toBe("A");
  });
  it("redistributes the incidents weight when incidents aren't tracked", () => {
    const g = assetHealthGrade({ ...mvpAugust, incidentsPer10k: null });
    expect(g.components.incidents).toBeNull();
    expect(g.score).toBeGreaterThan(97);
  });
  it("a breached covenant and thin margin drop the grade", () => {
    const g = assetHealthGrade({ ...mvpAugust, uptime: 0.915, contributionMargin: 0.35, vendorSla: 0.82 });
    expect(g.letter).toBe("D");
  });
  it("letters follow the thresholds", () => {
    expect([95, 87, 82, 77, 72, 65, 10].map(gradeLetter)).toEqual(["A", "A−", "B+", "B", "B−", "C", "D"]);
  });
});

describe("covenantStatus", () => {
  it("uptime 97.2% > 94% passes", () => expect(covenantStatus(0.972, ">", 0.94)).toBe("pass"));
  it("within 1 pt is at risk", () => expect(covenantStatus(0.945, ">", 0.94)).toBe("at_risk"));
  it("below is a breach", () => expect(covenantStatus(0.93, ">", 0.94)).toBe("breach"));
  it("not tracked when there is no value", () => expect(covenantStatus(null, ">", 0.94)).toBe("not_tracked"));
  it("supports <, <= and >= and value-type thresholds", () => {
    expect(covenantStatus(0.5, "<", 0.6)).toBe("pass");
    expect(covenantStatus(0.6, "<=", 0.6)).toBe("at_risk");
    expect(covenantStatus(100, ">=", 100, "value")).toBe("at_risk");
    expect(covenantStatus(120, ">=", 100, "value")).toBe("pass");
  });
});

describe("asset health grade without a reserve", () => {
  it("redistributes the reserve's weight instead of scoring it 0", () => {
    const base = {
      uptime: 0.972,
      uptimeCovenant: 0.94,
      contributionMargin: 0.541,
      marginTarget: 0.5,
      incidentsPer10k: 2.1,
      incidentTargetPer10k: 2.5,
      vendorSla: 0.93,
    };
    const none = assetHealthGrade({ ...base, reserveFunded: null });
    expect(none.components.reserve).toBeNull();
    expect(none.score).toBeGreaterThan(assetHealthGrade({ ...base, reserveFunded: 0 }).score);
  });
});
