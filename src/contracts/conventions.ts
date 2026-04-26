import { z } from "zod";

export const RouteNameSchema = z
  .string()
  .min(3)
  .regex(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/, "routeName must be dot-delimited lowercase tokens");

export type ContractDefinition<TQuery extends z.ZodTypeAny, TBody extends z.ZodTypeAny, TResponse extends z.ZodTypeAny> = {
  routeName: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query: TQuery;
  body: TBody;
  response: TResponse;
};

export const EmptySchema = z.object({}).strict();

export function defineContract<TQuery extends z.ZodTypeAny, TBody extends z.ZodTypeAny, TResponse extends z.ZodTypeAny>(
  contract: ContractDefinition<TQuery, TBody, TResponse>
): ContractDefinition<TQuery, TBody, TResponse> {
  RouteNameSchema.parse(contract.routeName);
  return contract;
}
