-- Table: admin_details
CREATE TABLE public.admin_details (
    id uuid NOT NULL,
    user_id uuid,
    admin_id varchar NOT NULL,
    permissions text[],
    created_at timestamptz,
    updated_at timestamptz
);

-- Table: announcements
CREATE TABLE public.announcements (
    id uuid NOT NULL,
    title varchar NOT NULL,
    content text NOT NULL,
    target_role varchar,
    is_active boolean,
    created_at timestamptz,
    expires_at timestamptz
);

-- Table: assignment_submissions
CREATE TABLE public.assignment_submissions (
    id uuid NOT NULL,
    assignment_id uuid,
    student_id uuid,
    file_url text,
    answer_text text,
    score integer,
    status varchar,
    graded_at timestamptz,
    submitted_at timestamptz
);

-- Table: assignments
CREATE TABLE public.assignments (
    id uuid NOT NULL,
    teacher_id uuid,
    unit_id uuid,
    title varchar NOT NULL,
    description text,
    type varchar,
    file_url text,
    due_date timestamptz,
    created_at timestamptz,
    updated_at timestamptz
);

-- Table: courses
CREATE TABLE public.courses (
    id uuid NOT NULL,
    title varchar NOT NULL,
    description text,
    short_code varchar NOT NULL,
    thumbnail_url text,
    difficulty varchar,
    duration_weeks integer,
    created_at timestamptz,
    updated_at timestamptz,
    department_id uuid,
    status varchar,
    tags text[]
);

-- Table: department
CREATE TABLE public.department (
    id uuid NOT NULL,
    name varchar NOT NULL,
    description text,
    short_code text NOT NULL,
    created_at timestamptz,
    parent_id uuid
);

-- Table: enrollments
CREATE TABLE public.enrollments (
    id uuid NOT NULL,
    student_id uuid,
    program_id uuid,
    enrolled_at timestamptz,
    progress integer,
    completed boolean,
    last_accessed timestamptz
);

-- Table: id_sequences
CREATE TABLE public.id_sequences (
    year integer NOT NULL,
    role varchar NOT NULL,
    current_sequence integer
);

-- Table: lecturer_units
CREATE TABLE public.lecturer_units (
    id uuid NOT NULL,
    lecturer_id uuid,
    unit_id uuid,
    program_id uuid
);

-- Table: live_classes
CREATE TABLE public.live_classes (
    id uuid NOT NULL,
    unit_id uuid,
    teacher_id uuid,
    title varchar NOT NULL,
    start_time timestamptz NOT NULL,
    end_time timestamptz,
    status varchar,
    live_url text,
    recording_url text,
    created_at timestamptz,
    updated_at timestamptz,
    token text
);

-- Table: program_units
CREATE TABLE public.program_units (
    id uuid NOT NULL,
    program_id uuid,
    unit_id uuid,
    semester integer,
    year integer
);

-- Table: progress
CREATE TABLE public.progress (
    id uuid NOT NULL,
    student_id uuid,
    topic_id uuid,
    is_completed boolean,
    completed_at timestamptz
);

-- Table: refresh_tokens
CREATE TABLE public.refresh_tokens (
    id uuid NOT NULL,
    user_id uuid,
    token varchar NOT NULL,
    created_at timestamptz
);

-- Table: student_details
CREATE TABLE public.student_details (
    id uuid NOT NULL,
    user_id uuid,
    student_id varchar NOT NULL,
    program_id uuid,
    year integer,
    created_at timestamptz,
    updated_at timestamptz
);

-- Table: student_units
CREATE TABLE public.student_units (
    id uuid NOT NULL,
    student_id uuid,
    unit_id uuid
);

-- Table: support_tickets
CREATE TABLE public.support_tickets (
    id uuid NOT NULL,
    user_id uuid,
    subject varchar NOT NULL,
    message text NOT NULL,
    status varchar,
    priority varchar,
    created_at timestamptz,
    updated_at timestamptz
);

-- Table: system_settings
CREATE TABLE public.system_settings (
    key varchar NOT NULL,
    value jsonb NOT NULL,
    description text,
    updated_at timestamptz
);

-- Table: teacher_details
CREATE TABLE public.teacher_details (
    id uuid NOT NULL,
    user_id uuid,
    teacher_id varchar NOT NULL,
    department_id uuid,
    national_id_number varchar,
    national_id_photo_url text,
    profile_photo_url text,
    created_at timestamptz,
    updated_at timestamptz
);

-- Table: topics
CREATE TABLE public.topics (
    id uuid NOT NULL,
    unit_id uuid,
    title varchar NOT NULL,
    video_url text,
    audio_intro_url text,
    notes_url text,
    notes text,
    sequence_number integer,
    content_type varchar,
    created_at timestamptz,
    updated_at timestamptz,
    status varchar
);

-- Table: units
CREATE TABLE public.units (
    id uuid NOT NULL,
    title varchar NOT NULL,
    description text,
    short_code varchar,
    created_at timestamptz,
    updated_at timestamptz
);

-- Table: users
CREATE TABLE public.users (
    id uuid NOT NULL,
    name varchar NOT NULL,
    email varchar NOT NULL,
    password varchar NOT NULL,
    role varchar NOT NULL,
    is_verified boolean,
    verification_token varchar,
    reset_password_token varchar,
    reset_password_expires timestamp,
    created_at timestamptz,
    updated_at timestamptz,
    verification_token_expires timestamptz
);