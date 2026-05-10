/**
 * Four routes: home picker, course detail (topic grid), topic detail
 * (walkthrough), and settings.
 */
export type Route =
  | { name: 'home' }
  | { name: 'walkthrough'; courseId: string }
  | { name: 'topic'; courseId: string; topicId: string; problem?: string }
  | { name: 'settings' };

export type RouteName = Route['name'];
