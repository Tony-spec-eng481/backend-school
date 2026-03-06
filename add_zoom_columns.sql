-- Migration: Add Zoom columns to live_classes table
-- Run this against your Supabase database

ALTER TABLE public.live_classes ADD COLUMN IF NOT EXISTS zoom_meeting_id bigint;
ALTER TABLE public.live_classes ADD COLUMN IF NOT EXISTS zoom_join_url text;
ALTER TABLE public.live_classes ADD COLUMN IF NOT EXISTS zoom_start_url text;
