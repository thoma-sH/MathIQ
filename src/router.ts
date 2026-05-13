/**
 * Routes: landing (home), course picker (lessons), course detail
 * (walkthrough), topic detail, history, settings, and exam mode (Pro).
 */
export type ExamId = 'exam1' | 'exam2' | 'exam3' | 'final';

export type Route =
  | { name: 'home' }
  | { name: 'lessons' }
  | { name: 'walkthrough'; courseId: string }
  | { name: 'topic'; courseId: string; topicId: string; problem?: string }
  | { name: 'history' }
  | { name: 'settings' }
  | { name: 'exams'; courseId: string }
  | { name: 'exam-take'; courseId: string; examId: ExamId };

export type RouteName = Route['name'];
