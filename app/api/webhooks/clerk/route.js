// app/api/webhooks/clerk/route.js
import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);

export async function POST(req) {


    try {
        // 1. Verify webhook
        const headerList = await headers();
        const svixId = headerList.get('svix-id');
        const svixTimestamp = headerList.get('svix-timestamp');
        const svixSignature = headerList.get('svix-signature');
        const payload = await req.text();

        if (!svixId || !svixTimestamp || !svixSignature) {
            return NextResponse.json({ error: 'Missing headers' }, { status: 400 });
        }

        const wh = new Webhook(process.env.CLERK_WEBHOOK_SECRET);
        const evt = wh.verify(payload, {
            'svix-id': svixId,
            'svix-timestamp': svixTimestamp,
            'svix-signature': svixSignature,
        });

        ('📦 Event:', evt.type, '| User:', evt.data);

        // 2. Handle only subscription events
        switch (evt.type) {
            case 'subscription.created':
                await updateUserSubscription(evt.data, 'created');
                break;

            case 'subscription.updated':
                await updateUserSubscription(evt.data, 'updated');
                break;

            case 'subscription.deleted':
            case 'subscription.cancelled':
                await cancelUserSubscription(evt.data);
                break;

            default:
                console.log('⚠️ Ignoring event:', evt.type);
        }

        return NextResponse.json({ received: true });

    } catch (error) {
        console.error('💥 Webhook error:', error);
        return NextResponse.json({ error: 'Webhook failed' }, { status: 500 });
    }
}

// Update user subscription (created/updated)
async function updateUserSubscription(data, action) {
    const clerkUserIdRaw = data.payer?.user_id;

    if (!clerkUserIdRaw) {
        throw new Error("❌ No user_id found in webhook payload");
    }

    const activeItem = data.items?.find((item) => item.status === "active");




    await convex.mutation(api.users.updateSubscription, {
        clerkUserId: clerkUserIdRaw, // ✅ fixed
        subscriptionId: data.id,
        plan: mapPlan(activeItem?.plan?.name),
        status: data.status,
        currentPeriodEnd: activeItem?.period_end,
    });

}

// Cancel user subscription
async function cancelUserSubscription(data) {
    const clerkUserId = data.payer.user_id;

    await convex.mutation(api.users.updateSubscription, {
        clerkUserId,
        subscriptionId: data.id,
        plan: "free",
        status: "cancelled",
        currentPeriodEnd: data.current_period_end,
    });

}

// Map Clerk plan to your internal plans
function mapPlan(clerkPlan) {
    if (!clerkPlan) return 'free';
    const plan = clerkPlan.toLowerCase();
    if (plan.includes('pro')) return 'pro';
    if (plan.includes('enterprise')) return 'enterprise';
    return 'free';
}

export const dynamic = 'force-dynamic';