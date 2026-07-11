import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Role } from './roles';

// Role matrix (PRD §3): per role, one route it may call and one it may not.
const MATRIX: {
  role: Role;
  allowed: Role[];
  denied: Role[];
}[] = [
  // Owner may change company settings; nothing in the matrix denies Owner
  // except engineer-only capture routes (owner does not capture attendance).
  { role: 'owner', allowed: ['owner', 'admin'], denied: ['engineer'] },
  // Admin may resolve exceptions but not change company settings.
  { role: 'admin', allowed: ['admin', 'engineer'], denied: ['owner'] },
  // Engineer may capture attendance but not approve payroll.
  { role: 'engineer', allowed: ['engineer'], denied: ['owner', 'admin'] },
];

function contextFor(userRole: Role | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => (userRole ? { user: { role: userRole } } : {}),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('E0-S03 RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);
  const withRequired = (roles: Role[] | undefined) =>
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(roles as unknown);

  afterEach(() => jest.restoreAllMocks());

  for (const { role, allowed, denied } of MATRIX) {
    it(`${role}: allowed on a @Roles(${allowed.join(',')}) route`, () => {
      withRequired(allowed);
      expect(guard.canActivate(contextFor(role))).toBe(true);
    });

    it(`${role}: denied on a @Roles(${denied.join(',')}) route`, () => {
      withRequired(denied);
      expect(() => guard.canActivate(contextFor(role))).toThrow(
        ForbiddenException,
      );
    });
  }

  it('allows any authenticated user when no roles are declared', () => {
    withRequired(undefined);
    expect(guard.canActivate(contextFor('engineer'))).toBe(true);
  });

  it('denies when there is no authenticated user on a role route', () => {
    withRequired(['admin']);
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
