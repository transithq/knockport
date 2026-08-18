import { describe, expect, it } from "vitest";
import { query } from "./query";

// Same fixture + cases as Bruno's @usebruno/query tests so the port stays
// behaviorally identical.
const data = {
  customer: {
    address: {
      city: "bangalore",
    },
    orders: [
      {
        id: "order-1",
        items: [
          { id: 1, amount: 10 },
          { id: 2, amount: 20 },
        ],
      },
      {
        id: "order-2",
        items: [
          { id: 3, amount: 30 },
          { id: 4, amount: 40 },
        ],
      },
    ],
  },
};

describe("query — dot navigation (F2, bruno-query port)", () => {
  it.each<[string, unknown]>([
    ["customer.address.city", "bangalore"],
    ["customer.orders.items.amount", [10, 20, 30, 40]],
    ["customer.orders.items.amount[0]", 10],
    ["..items.amount", [10, 20, 30, 40]],
    ["..amount", [10, 20, 30, 40]],
    ["..items.amount[0]", 10],
    ["..items[0].amount", 10],
    ["..items[5].amount", undefined],
    ["..id", ["order-1", 1, 2, "order-2", 3, 4]],
    ["customer.orders.foo", undefined],
    ["..customer.foo", undefined],
    ["..address", [{ city: "bangalore" }]],
    ["..address[0]", { city: "bangalore" }],
  ])("%s should be %j", (expr, result) => {
    expect(query(data, expr)).toEqual(result);
  });

  it.each<[string, unknown, unknown]>([
    ["..items[?].amount", [40], (i: any) => i.amount > 30],
    ["..items[?].amount", [40], { id: 4, amount: 40 }],
    ["..items[?].amount", undefined, { id: 5, amount: 40 }],
    ["..items..amount[?][0]", 40, (amt: unknown) => (amt as number) > 30],
    ["..items..amount[0][?]", undefined, (amt: unknown) => (amt as number) > 30],
    ["..items..amount[?]", [11, 21, 31, 41], (amt: unknown) => (amt as number) + 1],
    ["..items..amount[0][?]", 11, (amt: unknown) => (amt as number) + 1],
  ])("%s should be %j for %s", (expr, result, filter) => {
    expect(query(data, expr, filter as any)).toEqual(result);
  });

  it("throws when a [?] step has no filter function", () => {
    expect(() => query(data, "..items[?].amount")).toThrow(/missing function/);
  });
});