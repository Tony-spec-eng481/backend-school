-- Create notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    student_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    type varchar(50) NOT NULL, -- 'topic_completion', 'unit_completion', 'assignment_submission'
    message text NOT NULL,
    is_read boolean DEFAULT false,
    created_at timestamptz DEFAULT now()
);

-- Create live_class_attendance table
CREATE TABLE IF NOT EXISTS public.live_class_attendance (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    live_class_id uuid NOT NULL REFERENCES public.live_classes(id) ON DELETE CASCADE,
    student_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    joined_at timestamptz DEFAULT now(),
    left_at timestamptz,
    UNIQUE(live_class_id, student_id)
);    

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_live_class_attendance_ids ON public.live_class_attendance(live_class_id, student_id);
