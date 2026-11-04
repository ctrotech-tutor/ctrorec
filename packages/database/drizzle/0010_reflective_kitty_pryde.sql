CREATE TABLE "media_object_intents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"institution_id" uuid NOT NULL,
	"lecture_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_provider" text NOT NULL,
	"storage_key" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reconciliation_attempts" integer DEFAULT 0 NOT NULL,
	"attached_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_object_intents_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "media_object_intents_kind_valid" CHECK ("media_object_intents"."kind" IN ('original', 'data_saver')),
	CONSTRAINT "media_object_intents_status_valid" CHECK ("media_object_intents"."status" IN ('pending', 'attached', 'deleting', 'deleted')),
	CONSTRAINT "media_object_intents_storage_key_not_blank" CHECK (length(btrim("media_object_intents"."storage_key")) > 0),
	CONSTRAINT "media_object_intents_storage_provider_not_blank" CHECK (length(btrim("media_object_intents"."storage_provider")) > 0),
	CONSTRAINT "media_object_intents_byte_size_positive" CHECK ("media_object_intents"."byte_size" > 0),
	CONSTRAINT "media_object_intents_sha256_valid" CHECK ("media_object_intents"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "media_object_intents_reconciliation_attempts_valid" CHECK ("media_object_intents"."reconciliation_attempts" >= 0),
	CONSTRAINT "media_object_intents_state_complete" CHECK ((
        ("media_object_intents"."status" = 'attached' AND "media_object_intents"."attached_at" IS NOT NULL AND "media_object_intents"."deleted_at" IS NULL)
        OR ("media_object_intents"."status" = 'deleted' AND "media_object_intents"."deleted_at" IS NOT NULL AND "media_object_intents"."attached_at" IS NULL)
        OR ("media_object_intents"."status" IN ('pending', 'deleting') AND "media_object_intents"."attached_at" IS NULL AND "media_object_intents"."deleted_at" IS NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "media_object_intents" ADD CONSTRAINT "media_object_intents_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_object_intents" ADD CONSTRAINT "media_object_intents_lecture_fk" FOREIGN KEY ("lecture_id","institution_id") REFERENCES "public"."lectures"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_object_intents_lecture_idx" ON "media_object_intents" USING btree ("institution_id","lecture_id");--> statement-breakpoint
CREATE INDEX "media_object_intents_reconciliation_idx" ON "media_object_intents" USING btree ("status","updated_at");--> statement-breakpoint
INSERT INTO "media_object_intents" (
	"id", "institution_id", "lecture_id", "kind", "storage_provider",
	"storage_key", "byte_size", "sha256", "status", "reconciliation_attempts",
	"attached_at", "deleted_at", "created_at", "updated_at"
)
SELECT
	uuidv7(), "institution_id", "lecture_id", 'original', "storage_provider",
	"storage_key", "byte_size", "sha256", 'attached', 0,
	"created_at", NULL, "created_at", "created_at"
FROM "lecture_audio";--> statement-breakpoint
INSERT INTO "media_object_intents" (
	"id", "institution_id", "lecture_id", "kind", "storage_provider",
	"storage_key", "byte_size", "sha256", "status", "reconciliation_attempts",
	"attached_at", "deleted_at", "created_at", "updated_at"
)
SELECT
	uuidv7(), "institution_id", "lecture_id", 'data_saver', "storage_provider",
	"storage_key", "byte_size", "sha256", 'attached', 0,
	"completed_at", NULL, "created_at", COALESCE("completed_at", "created_at")
FROM "lecture_audio_derivatives"
WHERE "status" = 'ready';