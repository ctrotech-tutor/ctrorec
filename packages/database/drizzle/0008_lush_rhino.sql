CREATE TABLE "lecture_audio_captures" (
	"lecture_id" uuid PRIMARY KEY NOT NULL,
	"institution_id" uuid NOT NULL,
	"client_capture_id" uuid NOT NULL,
	"recorder_mime_type" text NOT NULL,
	"consent_attested_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"stopped_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"chunk_count" integer NOT NULL,
	"persistent_storage_granted" boolean NOT NULL,
	"stop_reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lecture_audio_captures_client_unique" UNIQUE("client_capture_id"),
	CONSTRAINT "lecture_audio_captures_mime_valid" CHECK (btrim("lecture_audio_captures"."recorder_mime_type") = "lecture_audio_captures"."recorder_mime_type" AND char_length("lecture_audio_captures"."recorder_mime_type") BETWEEN 1 AND 120),
	CONSTRAINT "lecture_audio_captures_times_valid" CHECK ("lecture_audio_captures"."consent_attested_at" <= "lecture_audio_captures"."started_at" AND "lecture_audio_captures"."started_at" <= "lecture_audio_captures"."stopped_at"),
	CONSTRAINT "lecture_audio_captures_measurements_valid" CHECK ("lecture_audio_captures"."duration_ms" >= 0 AND "lecture_audio_captures"."chunk_count" > 0),
	CONSTRAINT "lecture_audio_captures_stop_reason_valid" CHECK ("lecture_audio_captures"."stop_reason" IN ('stopped', 'interrupted', 'track-ended', 'recorder-error', 'size-limit'))
);
--> statement-breakpoint
ALTER TABLE "lecture_audio" DROP CONSTRAINT "lecture_audio_media_type_valid";--> statement-breakpoint
ALTER TABLE "lecture_audio_captures" ADD CONSTRAINT "lecture_audio_captures_original_fk" FOREIGN KEY ("lecture_id","institution_id") REFERENCES "public"."lecture_audio"("lecture_id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_audio" ADD CONSTRAINT "lecture_audio_media_type_valid" CHECK ("lecture_audio"."media_type" IN ('audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/webm', 'audio/ogg'));