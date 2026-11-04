CREATE TABLE "institution_invitation_roles" (
	"institution_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "institution_invitation_roles_pkey" PRIMARY KEY("institution_id","invitation_id","role"),
	CONSTRAINT "institution_invitation_roles_role_valid" CHECK ("institution_invitation_roles"."role" IN ('institution_admin', 'academic_staff', 'student'))
);
--> statement-breakpoint
CREATE TABLE "institution_invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"institution_id" uuid NOT NULL,
	"invited_by_membership_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" uuid,
	"accepted_membership_id" uuid,
	"revoked_at" timestamp with time zone,
	"revocation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "institution_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "institution_invitations_id_institution_unique" UNIQUE("id","institution_id"),
	CONSTRAINT "institution_invitations_email_normalized" CHECK ("institution_invitations"."email" = lower(btrim("institution_invitations"."email")) AND position('@' IN "institution_invitations"."email") > 1),
	CONSTRAINT "institution_invitations_display_name_nonempty" CHECK (btrim("institution_invitations"."display_name") <> ''),
	CONSTRAINT "institution_invitations_token_hash_valid" CHECK ("institution_invitations"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "institution_invitations_expiry_valid" CHECK ("institution_invitations"."expires_at" > "institution_invitations"."created_at"),
	CONSTRAINT "institution_invitations_acceptance_complete" CHECK (("institution_invitations"."accepted_at" IS NULL AND "institution_invitations"."accepted_user_id" IS NULL AND "institution_invitations"."accepted_membership_id" IS NULL) OR ("institution_invitations"."accepted_at" IS NOT NULL AND "institution_invitations"."accepted_user_id" IS NOT NULL AND "institution_invitations"."accepted_membership_id" IS NOT NULL)),
	CONSTRAINT "institution_invitations_revocation_complete" CHECK (("institution_invitations"."revoked_at" IS NULL AND "institution_invitations"."revocation_reason" IS NULL) OR ("institution_invitations"."revoked_at" IS NOT NULL AND "institution_invitations"."revocation_reason" IN ('administrator', 'replaced'))),
	CONSTRAINT "institution_invitations_not_accepted_and_revoked" CHECK ("institution_invitations"."accepted_at" IS NULL OR "institution_invitations"."revoked_at" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "institution_invitation_roles" ADD CONSTRAINT "institution_invitation_roles_invitation_fk" FOREIGN KEY ("invitation_id","institution_id") REFERENCES "public"."institution_invitations"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_invitations" ADD CONSTRAINT "institution_invitations_institution_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_invitations" ADD CONSTRAINT "institution_invitations_issuer_fk" FOREIGN KEY ("invited_by_membership_id","institution_id") REFERENCES "public"."memberships"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_invitations" ADD CONSTRAINT "institution_invitations_accepted_user_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_invitations" ADD CONSTRAINT "institution_invitations_accepted_membership_fk" FOREIGN KEY ("accepted_membership_id","institution_id") REFERENCES "public"."memberships"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "institution_invitations_one_open_email_unique" ON "institution_invitations" USING btree ("institution_id","email") WHERE "institution_invitations"."accepted_at" IS NULL AND "institution_invitations"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "institution_invitations_institution_created_idx" ON "institution_invitations" USING btree ("institution_id","created_at");