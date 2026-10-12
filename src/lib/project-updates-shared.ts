export const PROJECT_UPDATE_SELECT =
  'id, body, progress, created_at, author:profiles!project_updates_author_id_fkey(id, full_name, email, photo_url, designation)'
