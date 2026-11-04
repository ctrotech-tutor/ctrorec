CREATE TABLE "account_recovery_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"user_id" uuid,
	"token_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revocation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_recovery_requests_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "account_recovery_requests_email_normalized" CHECK ("account_recovery_requests"."email" = lower(btrim("account_recovery_requests"."email")) AND position('@' IN "account_recovery_requests"."email") > 1),
	CONSTRAINT "account_recovery_requests_token_hash_valid" CHECK ("account_recovery_requests"."token_hash" IS NULL OR "account_recovery_requests"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "account_recovery_requests_expiry_valid" CHECK ("account_recovery_requests"."expires_at" > "account_recovery_requests"."created_at"),
	CONSTRAINT "account_recovery_requests_status_valid" CHECK ("account_recovery_requests"."status" IN ('pending', 'delivering', 'delivered', 'failed', 'discarded', 'expired', 'consumed', 'revoked')),
	CONSTRAINT "account_recovery_requests_token_user_complete" CHECK ("account_recovery_requests"."token_hash" IS NULL OR "account_recovery_requests"."user_id" IS NOT NULL),
	CONSTRAINT "account_recovery_requests_delivery_state_valid" CHECK (("account_recovery_requests"."status" = 'pending' AND "account_recovery_requests"."token_hash" IS NULL AND "account_recovery_requests"."delivered_at" IS NULL AND "account_recovery_requests"."consumed_at" IS NULL) OR ("account_recovery_requests"."status" IN ('delivering', 'failed') AND "account_recovery_requests"."token_hash" IS NOT NULL AND "account_recovery_requests"."delivered_at" IS NULL AND "account_recovery_requests"."consumed_at" IS NULL) OR ("account_recovery_requests"."status" = 'delivered' AND "account_recovery_requests"."token_hash" IS NOT NULL AND "account_recovery_requests"."delivered_at" IS NOT NULL AND "account_recovery_requests"."consumed_at" IS NULL) OR ("account_recovery_requests"."status" = 'consumed' AND "account_recovery_requests"."token_hash" IS NOT NULL AND "account_recovery_requests"."delivered_at" IS NOT NULL AND "account_recovery_requests"."consumed_at" IS NOT NULL) OR ("account_recovery_requests"."status" IN ('discarded', 'expired', 'revoked') AND "account_recovery_requests"."consumed_at" IS NULL)),
	CONSTRAINT "account_recovery_requests_revocation_complete" CHECK (("account_recovery_requests"."revoked_at" IS NULL AND "account_recovery_requests"."revocation_reason" IS NULL) OR ("account_recovery_requests"."revoked_at" IS NOT NULL AND "account_recovery_requests"."revocation_reason" IN ('replaced', 'reset'))),
	CONSTRAINT "account_recovery_requests_not_consumed_and_revoked" CHECK ("account_recovery_requests"."consumed_at" IS NULL OR "account_recovery_requests"."revoked_at" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "account_recovery_requests" ADD CONSTRAINT "account_recovery_requests_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_recovery_requests_email_status_idx" ON "account_recovery_requests" USING btree ("email","status");--> statement-breakpoint
CREATE INDEX "account_recovery_requests_user_idx" ON "account_recovery_requests" USING btree ("user_id");