ALTER TABLE "lecture_audio_captures" ADD COLUMN "hashing_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "lecture_audio_captures" ADD COLUMN "upload_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "lecture_audio_captures" ADD COLUMN "upload_retry_count" integer;--> statement-breakpoint
ALTER TABLE "lecture_audio_captures" ADD CONSTRAINT "lecture_audio_captures_handoff_measurements_valid" CHECK ((
        "lecture_audio_captures"."hashing_duration_ms" IS NULL
        AND "lecture_audio_captures"."upload_duration_ms" IS NULL
        AND "lecture_audio_captures"."upload_retry_count" IS NULL
      ) OR (
        "lecture_audio_captures"."hashing_duration_ms" IS NOT NULL
        AND "lecture_audio_captures"."upload_duration_ms" IS NOT NULL
        AND "lecture_audio_captures"."upload_retry_count" IS NOT NULL
        AND "lecture_audio_captures"."hashing_duration_ms" >= 0
        AND "lecture_audio_captures"."upload_duration_ms" >= 0
        AND "lecture_audio_captures"."upload_retry_count" >= 0
      ));