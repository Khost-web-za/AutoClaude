import { startTransition, type FormEvent } from 'react';

/**
 * `onSubmit` for a `useActionState` form whose fields are controlled. Passing the dispatcher as
 * `<form action>` makes React reset the form after the action, and react-aria fields answer that reset
 * by reverting to their first-render values, so a saved or rejected form would show stale input.
 * Dispatching from `onSubmit` (in a transition, so `isPending` works) skips that reset.
 */
export function submitWithoutReset(dispatch: (formData: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  };
}
