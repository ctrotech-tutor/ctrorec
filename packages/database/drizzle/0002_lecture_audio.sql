CREATE TABLE "lecture_audio" (
	"lecture_id" uuid PRIMARY KEY NOT NULL,
	"institution_id" uuid NOT NULL,
	"uploaded_by_membership_id" uuid NOT NULL,
	"storage_provider" text NOT NULL,
	"storage_key" text NOT NULL,
	"original_file_name" text NOT NULL,
	"media_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lecture_audio_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "lecture_audio_storage_fields_valid" CHECK (btrim("lecture_audio"."storage_provider") <> '' AND btrim("lecture_audio"."storage_key") <> ''),
	CONSTRAINT "lecture_audio_file_name_valid" CHECK (btrim("lecture_audio"."original_file_name") = "lecture_audio"."original_file_name" AND char_length("lecture_audio"."original_file_name") BETWEEN 1 AND 255),
	CONSTRAINT "lecture_audio_media_type_valid" CHECK ("lecture_audio"."media_type" IN ('audio/mpeg', 'audio/wav', 'audio/mp4')),
	CONSTRAINT "lecture_audio_byte_size_positive" CHECK ("lecture_audio"."byte_size" > 0),
	CONSTRAINT "lecture_audio_sha256_valid" CHECK ("lecture_audio"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "lecture_audio" ADD CONSTRAINT "lecture_audio_institution_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_audio" ADD CONSTRAINT "lecture_audio_lecture_fk" FOREIGN KEY ("lecture_id","institution_id") REFERENCES "public"."lectures"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_audio" ADD CONSTRAINT "lecture_audio_uploader_fk" FOREIGN KEY ("uploaded_by_membership_id","institution_id") REFERENCES "public"."memberships"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lecture_audio_uploader_idx" ON "lecture_audio" USING btree ("uploaded_by_membership_id");