import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { PaginationQueryDto } from "./pagination.dto";

describe("PaginationQueryDto", () => {
  it("defaults the page size and accepts a bounded integer", async () => {
    const defaults = plainToInstance(PaginationQueryDto, {});
    const bounded = plainToInstance(PaginationQueryDto, {
      limit: "100",
      after: "cursor_01",
    });

    expect(defaults.limit).toBe(25);
    expect(await validate(defaults)).toHaveLength(0);
    expect(bounded.limit).toBe(100);
    expect(await validate(bounded)).toHaveLength(0);
  });

  it("rejects oversized pages and malformed cursors", async () => {
    const query = plainToInstance(PaginationQueryDto, {
      limit: "101",
      after: "cursor/with spaces",
    });
    const errors = await validate(query);
    const properties = errors.map((error) => error.property);

    expect(properties).toContain("limit");
    expect(properties).toContain("after");
  });
});
