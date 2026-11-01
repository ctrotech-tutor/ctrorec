CREATE TABLE "lecture_audio_derivatives" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"lecture_id" uuid NOT NULL,
	"institution_id" uuid NOT NULL,
	"kind" text DEFAULT 'data_saver' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"source_sha256" text NOT NULL,
	"storage_provider" text,
	"storage_key" text,
	"media_type" text DEFAULT 'audio/mp4' NOT NULL,
	"byte_size" bigint,
	"sha256" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"processing_started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lecture_audio_derivatives_lecture_kind_unique" UNIQUE("lecture_id","kind"),
	CONSTRAINT "lecture_audio_derivatives_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "lecture_audio_derivatives_kind_valid" CHECK ("lecture_audio_derivatives"."kind" = 'data_saver'),
	CONSTRAINT "lecture_audio_derivatives_status_valid" CHECK ("lecture_audio_derivatives"."status" IN ('pending', 'processing', 'ready', 'failed')),
	CONSTRAINT "lecture_audio_derivatives_source_sha256_valid" CHECK ("lecture_audio_derivatives"."source_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "lecture_audio_derivatives_media_type_valid" CHECK ("lecture_audio_derivatives"."media_type" = 'audio/mp4'),
	CONSTRAINT "lecture_audio_derivatives_attempts_valid" CHECK ("lecture_audio_derivatives"."attempts" >= 0),
	CONSTRAINT "lecture_audio_derivatives_processing_state_valid" CHECK (("lecture_audio_derivatives"."status" = 'processing' AND "lecture_audio_derivatives"."processing_started_at" IS NOT NULL) OR ("lecture_audio_derivatives"."status" <> 'processing' AND "lecture_audio_derivatives"."processing_started_at" IS NULL)),
	CONSTRAINT "lecture_audio_derivatives_ready_state_valid" CHECK (("lecture_audio_derivatives"."status" = 'ready' AND "lecture_audio_derivatives"."storage_provider" IS NOT NULL AND btrim("lecture_audio_derivatives"."storage_provider") <> '' AND "lecture_audio_derivatives"."storage_key" IS NOT NULL AND btrim("lecture_audio_derivatives"."storage_key") <> '' AND "lecture_audio_derivatives"."byte_size" IS NOT NULL AND "lecture_audio_derivatives"."byte_size" > 0 AND "lecture_audio_derivatives"."sha256" IS NOT NULL AND "lecture_audio_derivatives"."sha256" ~ '^[0-9a-f]{64}$' AND "lecture_audio_derivatives"."completed_at" IS NOT NULL) OR ("lecture_audio_derivatives"."status" <> 'ready' AND "lecture_audio_derivatives"."storage_provider" IS NULL AND "lecture_audio_derivatives"."storage_key" IS NULL AND "lecture_audio_derivatives"."byte_size" IS NULL AND "lecture_audio_derivatives"."sha256" IS NULL AND "lecture_audio_derivatives"."completed_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "lecture_audio" ADD CONSTRAINT "lecture_audio_lecture_institution_unique" UNIQUE("lecture_id","institution_id");--> statement-breakpoint
ALTER TABLE "lecture_audio_derivatives" ADD CONSTRAINT "lecture_audio_derivatives_institution_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_audio_derivatives" ADD CONSTRAINT "lecture_audio_derivatives_original_fk" FOREIGN KEY ("lecture_id","institution_id") REFERENCES "public"."lecture_audio"("lecture_id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lecture_audio_derivatives_status_idx" ON "lecture_audio_derivatives" USING btree ("status","updated_at");