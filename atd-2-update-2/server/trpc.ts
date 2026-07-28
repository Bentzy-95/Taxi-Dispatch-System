import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

export interface Context {
  accessCode: string | undefined;
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // Without this, a failed form validation (e.g. a blank required
    // field) surfaces to the user as a raw JSON dump of Zod's internal
    // issue objects instead of a plain sentence.
    let message = shape.message;
    if (error.cause instanceof ZodError) {
      message = error.cause.issues[0]?.message ?? "Please check the form and try again.";
    }

    // Never send internal stack traces (file paths, library internals)
    // to the browser - log server-side only, keep the client response clean.
    if (process.env.NODE_ENV !== "production") {
      console.error(error);
    }
    const { stack: _stack, ...dataWithoutStack } = shape.data;

    return { ...shape, message, data: dataWithoutStack };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * Requires a correct ACCESS_CODE (set as an env var) to be sent as the
 * x-access-code header. If ACCESS_CODE isn't configured on the server at
 * all, the dispatch board is left open - this keeps local development
 * friction-free while making protection the default the moment a real
 * deployment sets the env var.
 */
const requireAccessCode = t.middleware(({ ctx, next }) => {
  const required = process.env.ACCESS_CODE;
  if (required && ctx.accessCode !== required) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Enter the dispatch passcode to continue." });
  }
  return next();
});

export const protectedProcedure = publicProcedure.use(requireAccessCode);
