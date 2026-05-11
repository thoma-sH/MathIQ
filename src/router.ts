/**
 * Five routes: landing (home), course picker (lessons), course detail
 * (walkthrough), topic detail, settings.
 */
export type Route =
  | { name: 'home' }
  | { name: 'lessons' }
  | { name: 'walkthrough'; courseId: string }
  | { name: 'topic'; courseId: string; topicId: string; problem?: string }
  | { name: 'settings' };

export type RouteName = Route['name'];
