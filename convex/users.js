import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const storeUser = mutation({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();

        if (!identity) {
            throw new Error("Called storeUser without authentication present");
        }

        // Check if we've already stored this identity before.
        const user = await ctx.db
            .query("users")
            .withIndex("by_token", (q) =>
                q.eq("tokenIdentifier", identity.tokenIdentifier),
            )
            .unique();
        if (user !== null) {
            // If we've seen this identity before but the name has changed, patch the value.
            if (user.name !== identity.name) {
                await ctx.db.patch(user._id, { name: identity.name });
            }
            return user._id;
        }

        // If it's a new identity, create a new `User`.
        return await ctx.db.insert("users", {
            name: identity.name ?? "Anonymous",
            tokenIdentifier: identity.tokenIdentifier,
            clerkUserId: identity.subject,
            email: identity.email,
            imageUrl: identity.pictureUrl,
            plan: "free",
            projectsUsed: 0,
            exportsThisMonth: 0,
            createdAt: Date.now(),
            lastActiveAt: Date.now(),
        });
    },
});

export const getCurrentUser = query({
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_token", (q) =>
                q.eq("tokenIdentifier", identity.tokenIdentifier)
            )
            .unique();

        if (!user) {
            throw new Error("User not found");
        }

        return user;
    },
});

export const updateSubscription = mutation({
    args: {
        clerkUserId: v.string(),
        subscriptionId: v.string(),
        plan: v.union(v.literal("free"), v.literal("pro"), v.literal("enterprise")),
        status: v.string(),
        currentPeriodEnd: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        // Find user by Clerk ID
        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkUserId", args.clerkUserId))
            .unique();

        if (!user) {
            throw new Error(`User not found: ${args.clerkUserId}`);
        }


        // Update subscription info
        await ctx.db.patch(user._id, {
            plan: args.plan,
            subscriptionId: args.subscriptionId,
            subscriptionStatus: args.status,
            currentPeriodEnd: args.currentPeriodEnd,
        });

    },
});
