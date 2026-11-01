CREATE TABLE "lecture_audio_uploads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"lecture_id" uuid NOT NULL,
	"institution_id" uuid NOT NULL,
	"created_by_membership_id" uuid NOT NULL,
	"original_file_name" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"received_bytes" bigint DEFAULT 0 NOT NULL,
	"chunk_size" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lecture_audio_uploads_file_name_valid" CHECK (btrim("lecture_audio_uploads"."original_file_name") = "lecture_audio_uploads"."original_file_name" AND char_length("lecture_audio_uploads"."original_file_name") BETWEEN 1 AND 255),
	CONSTRAINT "lecture_audio_uploads_byte_size_positive" CHECK ("lecture_audio_uploads"."byte_size" > 0),
	CONSTRAINT "lecture_audio_uploads_sha256_valid" CHECK ("lecture_audio_uploads"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "lecture_audio_uploads_received_bytes_valid" CHECK ("lecture_audio_uploads"."received_bytes" >= 0 AND "lecture_audio_uploads"."received_bytes" <= "lecture_audio_uploads"."byte_size"),
	CONSTRAINT "lecture_audio_uploads_chunk_size_valid" CHECK ("lecture_audio_uploads"."chunk_size" BETWEEN 16384 AND 8388608),
	CONSTRAINT "lecture_audio_uploads_status_valid" CHECK ("lecture_audio_uploads"."status" IN ('active', 'completed', 'cancelled', 'expired')),
	CONSTRAINT "lecture_audio_uploads_completion_valid" CHECK (("lecture_audio_uploads"."status" = 'completed' AND "lecture_audio_uploads"."received_bytes" = "lecture_audio_uploads"."byte_size" AND "lecture_audio_uploads"."completed_at" IS NOT NULL) OR ("lecture_audio_uploads"."status" <> 'completed' AND "lecture_audio_uploads"."completed_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "lecture_audio_uploads" ADD CONSTRAINT "lecture_audio_uploads_institution_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_audio_uploads" ADD CONSTRAINT "lecture_audio_uploads_lecture_fk" FOREIGN KEY ("lecture_id","institution_id") REFERENCES "public"."lectures"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_audio_uploads" ADD CONSTRAINT "lecture_audio_uploads_creator_fk" FOREIGN KEY ("created_by_membership_id","institution_id") REFERENCES "public"."memberships"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lecture_audio_uploads_active_lecture_unique" ON "lecture_audio_uploads" USING btree ("lecture_id") WHERE "lecture_audio_uploads"."status" = 'active';--> statement-breakpoint
CREATE INDEX "lecture_audio_uploads_expiry_idx" ON "lecture_audio_uploads" USING btree ("status","expires_at");