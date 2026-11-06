import { describe, expect, it } from "vitest";
import { moveInOrder, repositioned, workoutOrder } from "../workout-order";

const items = [{ id: "a", position: 0, sets: ["s1", "s2"] }, { id: "b", position: 1, sets: [] }, { id: "c", position: 3, sets: ["s3"] }];
const runs = [{ id: "r", position: 2, distance_m: 5000 }];

describe("workout order", () => {
  it("interleaves exercises and runs by position", () => {
    expect(workoutOrder(items, runs).map((e) => e.id)).toEqual(["a", "b", "r", "c"]);
  });

  it("puts exercises before runs when positions tie (legacy rows)", () => {
    expect(workoutOrder([{ id: "x", position: 0 }], [{ id: "y", position: 0 }]).map((e) => e.id)).toEqual(["x", "y"]);
  });

  it("moves one place and renumbers 0..n-1", () => {
    const pos = moveInOrder(workoutOrder(items, runs), "c", -1)!;
    expect([...pos.entries()]).toEqual([["a", 0], ["b", 1], ["c", 2], ["r", 3]]);
  });

  it("refuses to move past the top or bottom", () => {
    const order = workoutOrder(items, runs);
    expect(moveInOrder(order, "a", -1)).toBeNull();
    expect(moveInOrder(order, "c", 1)).toBeNull();
    expect(moveInOrder(order, "missing", 1)).toBeNull();
  });

  it("repeated moves walk an exercise from bottom to top, one place each", () => {
    let its = items.map((i) => ({ ...i }));
    let rs = runs.map((r) => ({ ...r }));
    const seen: string[][] = [];
    for (let k = 0; k < 3; k++) {
      const pos = moveInOrder(workoutOrder(its, rs), "c", -1)!;
      its = its.map((i) => ({ ...i, position: pos.get(i.id)! }));
      rs = rs.map((r) => ({ ...r, position: pos.get(r.id)! }));
      seen.push(workoutOrder(its, rs).map((e) => e.id));
    }
    expect(seen).toEqual([["a", "b", "c", "r"], ["a", "c", "b", "r"], ["c", "a", "b", "r"]]);
    expect(moveInOrder(workoutOrder(its, rs), "c", -1)).toBeNull();
  });

  it("changes only positions: logged sets and run values stay as they were", () => {
    const pos = moveInOrder(workoutOrder(items, runs), "r", 1)!;
    const changedItems = repositioned(items, pos);
    const changedRuns = repositioned(runs, pos);
    expect(changedItems).toEqual([{ id: "c", position: 2, sets: ["s3"] }]);
    expect(changedRuns).toEqual([{ id: "r", position: 3, distance_m: 5000 }]);
  });
});
