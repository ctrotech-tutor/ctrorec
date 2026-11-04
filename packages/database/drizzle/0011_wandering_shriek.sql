CREATE TABLE "lecture_media_deletions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"institution_id" uuid NOT NULL,
	"lecture_id" uuid NOT NULL,
	"requested_by_membership_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"original_file_name" text NOT NULL,
	"original_media_type" text NOT NULL,
	"original_byte_size" bigint NOT NULL,
	"original_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "lecture_media_deletions_lecture_unique" UNIQUE("lecture_id"),
	CONSTRAINT "lecture_media_deletions_reason_valid" CHECK (btrim("lecture_media_deletions"."reason") = "lecture_media_deletions"."reason" AND char_length("lecture_media_deletions"."reason") BETWEEN 1 AND 500),
	CONSTRAINT "lecture_media_deletions_original_file_name_valid" CHECK (btrim("lecture_media_deletions"."original_file_name") = "lecture_media_deletions"."original_file_name" AND char_length("lecture_media_deletions"."original_file_name") BETWEEN 1 AND 255),
	CONSTRAINT "lecture_media_deletions_original_media_type_valid" CHECK ("lecture_media_deletions"."original_media_type" IN ('audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/webm', 'audio/ogg')),
	CONSTRAINT "lecture_media_deletions_original_size_positive" CHECK ("lecture_media_deletions"."original_byte_size" > 0),
	CONSTRAINT "lecture_media_deletions_original_sha256_valid" CHECK ("lecture_media_deletions"."original_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "lecture_media_deletions_completion_valid" CHECK ("lecture_media_deletions"."completed_at" IS NULL OR "lecture_media_deletions"."completed_at" >= "lecture_media_deletions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "lecture_media_holds" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"institution_id" uuid NOT NULL,
	"lecture_id" uuid NOT NULL,
	"created_by_membership_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by_membership_id" uuid,
	"release_reason" text,
	"released_at" timestamp with time zone,
	CONSTRAINT "lecture_media_holds_reason_valid" CHECK (btrim("lecture_media_holds"."reason") = "lecture_media_holds"."reason" AND char_length("lecture_media_holds"."reason") BETWEEN 1 AND 500),
	CONSTRAINT "lecture_media_holds_release_complete" CHECK ((
        ("lecture_media_holds"."released_at" IS NULL AND "lecture_media_holds"."released_by_membership_id" IS NULL AND "lecture_media_holds"."release_reason" IS NULL)
        OR ("lecture_media_holds"."released_at" IS NOT NULL AND "lecture_media_holds"."released_at" >= "lecture_media_holds"."created_at" AND "lecture_media_holds"."released_by_membership_id" IS NOT NULL AND btrim("lecture_media_holds"."release_reason") = "lecture_media_holds"."release_reason" AND char_length("lecture_media_holds"."release_reason") BETWEEN 1 AND 500)
      ))
);
--> statement-breakpoint
ALTER TABLE "media_object_intents" DROP CONSTRAINT "media_object_intents_state_complete";--> statement-breakpoint
ALTER TABLE "lecture_audio_captures" DROP CONSTRAINT "lecture_audio_captures_original_fk";
--> statement-breakpoint
ALTER TABLE "media_object_intents" ADD COLUMN "deletion_request_id" uuid;--> statement-breakpoint
ALTER TABLE "lecture_media_deletions" ADD CONSTRAINT "lecture_media_deletions_institution_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_media_deletions" ADD CONSTRAINT "lecture_media_deletions_lecture_fk" FOREIGN KEY ("lecture_id","institution_id") REFERENCES "public"."lectures"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_media_deletions" ADD CONSTRAINT "lecture_media_deletions_requester_fk" FOREIGN KEY ("requested_by_membership_id","institution_id") REFERENCES "public"."memberships"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_media_holds" ADD CONSTRAINT "lecture_media_holds_institution_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_media_holds" ADD CONSTRAINT "lecture_media_holds_lecture_fk" FOREIGN KEY ("lecture_id","institution_id") REFERENCES "public"."lectures"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_media_holds" ADD CONSTRAINT "lecture_media_holds_creator_fk" FOREIGN KEY ("created_by_membership_id","institution_id") REFERENCES "public"."memberships"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_media_holds" ADD CONSTRAINT "lecture_media_holds_releaser_fk" FOREIGN KEY ("released_by_membership_id","institution_id") REFERENCES "public"."memberships"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lecture_media_deletions_institution_idx" ON "lecture_media_deletions" USING btree ("institution_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lecture_media_holds_active_lecture_unique" ON "lecture_media_holds" USING btree ("lecture_id") WHERE "lecture_media_holds"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "lecture_media_holds_institution_idx" ON "lecture_media_holds" USING btree ("institution_id","lecture_id","created_at");--> statement-breakpoint
ALTER TABLE "lecture_audio_captures" ADD CONSTRAINT "lecture_audio_captures_lecture_fk" FOREIGN KEY ("lecture_id","institution_id") REFERENCES "public"."lectures"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_object_intents" ADD CONSTRAINT "media_object_intents_deletion_request_fk" FOREIGN KEY ("deletion_request_id") REFERENCES "public"."lecture_media_deletions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_object_intents_deletion_request_idx" ON "media_object_intents" USING btree ("deletion_request_id");--> statement-breakpoint
ALTER TABLE "media_object_intents" ADD CONSTRAINT "media_object_intents_state_complete" CHECK ((
        ("media_object_intents"."status" = 'pending' AND "media_object_intents"."attached_at" IS NULL AND "media_object_intents"."deleted_at" IS NULL)
        OR ("media_object_intents"."status" = 'attached' AND "media_object_intents"."attached_at" IS NOT NULL AND "media_object_intents"."deleted_at" IS NULL)
        OR ("media_object_intents"."status" = 'deleting' AND "media_object_intents"."deleted_at" IS NULL)
        OR ("media_object_intents"."status" = 'deleted' AND "media_object_intents"."deleted_at" IS NOT NULL)
      ));