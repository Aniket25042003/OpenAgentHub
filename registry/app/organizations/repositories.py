from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import utcnow
from app.organizations.models import (
    Invitation,
    Organization,
    OrganizationMember,
    ServiceAccount,
    Team,
    TeamMember,
)


class OrganizationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def by_slug(self, slug: str) -> Organization | None:
        return (
            await self.session.execute(
                select(Organization).where(Organization.slug == slug)
            )
        ).scalar_one_or_none()

    async def by_id(self, organization_id: int) -> Organization | None:
        return await self.session.get(Organization, organization_id)

    async def active_membership(self, organization_id: int, user_id: int) -> OrganizationMember | None:
        """Return the membership only when the organization itself is active."""
        row = (
            await self.session.execute(
                select(OrganizationMember)
                .join(Organization, Organization.id == OrganizationMember.organization_id)
                .where(
                    OrganizationMember.organization_id == organization_id,
                    OrganizationMember.user_id == user_id,
                    Organization.status == "active",
                )
            )
        ).scalar_one_or_none()
        return row

    async def create(
        self, *, slug: str, display_name: str, owner_id: int
    ) -> Organization:
        org = Organization(slug=slug, display_name=display_name)
        self.session.add(org)
        await self.session.flush()
        self.session.add(
            OrganizationMember(organization_id=org.id, user_id=owner_id, role="owner")
        )
        return org

    async def for_user(self, user_id: int) -> list[tuple[Organization, str]]:
        stmt = (
            select(Organization, OrganizationMember.role)
            .join(
                OrganizationMember,
                OrganizationMember.organization_id == Organization.id,
            )
            .where(OrganizationMember.user_id == user_id)
            .order_by(Organization.slug)
        )
        return list((await self.session.execute(stmt)).all())

    async def membership(
        self, organization: Organization, user_id: int
    ) -> OrganizationMember | None:
        return (
            await self.session.execute(
                select(OrganizationMember).where(
                    OrganizationMember.organization_id == organization.id,
                    OrganizationMember.user_id == user_id,
                )
            )
        ).scalar_one_or_none()

    async def members(self, organization: Organization) -> list[OrganizationMember]:
        return (
            (
                await self.session.execute(
                    select(OrganizationMember)
                    .where(OrganizationMember.organization_id == organization.id)
                    .order_by(OrganizationMember.role, OrganizationMember.user_id)
                )
            )
            .scalars()
            .all()
        )

    async def add_member(
        self, organization: Organization, user_id: int, role: str
    ) -> OrganizationMember:
        member = OrganizationMember(
            organization_id=organization.id, user_id=user_id, role=role
        )
        self.session.add(member)
        return member


class TeamRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def by_id(self, team_id: int) -> Team | None:
        return await self.session.get(Team, team_id)

    async def in_organization(
        self, organization: Organization, name: str
    ) -> Team | None:
        return (
            await self.session.execute(
                select(Team).where(
                    Team.organization_id == organization.id, Team.name == name
                )
            )
        ).scalar_one_or_none()

    async def list_for(self, organization: Organization) -> list[Team]:
        return (
            (
                await self.session.execute(
                    select(Team)
                    .where(Team.organization_id == organization.id)
                    .order_by(Team.name)
                )
            )
            .scalars()
            .all()
        )

    async def create(self, organization: Organization, name: str) -> Team:
        team = Team(organization_id=organization.id, name=name)
        self.session.add(team)
        await self.session.flush()
        return team

    async def members(self, team: Team) -> list[TeamMember]:
        return (
            (
                await self.session.execute(
                    select(TeamMember).where(TeamMember.team_id == team.id)
                )
            )
            .scalars()
            .all()
        )

    async def membership(self, team: Team, user_id: int) -> TeamMember | None:
        return (
            await self.session.execute(
                select(TeamMember).where(
                    TeamMember.team_id == team.id, TeamMember.user_id == user_id
                )
            )
        ).scalar_one_or_none()

    async def add_member(self, team: Team, user_id: int) -> TeamMember:
        row = TeamMember(team_id=team.id, user_id=user_id)
        self.session.add(row)
        return row


class InvitationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def by_token_hash(self, token_hash: str) -> Invitation | None:
        return (
            await self.session.execute(
                select(Invitation).where(Invitation.token_hash == token_hash)
            )
        ).scalar_one_or_none()

    async def for_organization(self, organization: Organization) -> list[Invitation]:
        return (
            (
                await self.session.execute(
                    select(Invitation)
                    .where(Invitation.organization_id == organization.id)
                    .order_by(Invitation.created_at.desc())
                )
            )
            .scalars()
            .all()
        )

    async def create(
        self,
        *,
        organization: Organization,
        invited_by_id: int,
        role: str,
        team_id: int | None,
        token_hash: str,
        email: str,
        expires_at: datetime,
    ) -> Invitation:
        row = Invitation(
            organization_id=organization.id,
            invited_by_id=invited_by_id,
            role=role,
            team_id=team_id,
            token_hash=token_hash,
            email=email,
            expires_at=expires_at,
        )
        self.session.add(row)
        await self.session.flush()
        return row

    async def mark_accepted(self, invitation: Invitation, user_id: int) -> None:
        invitation.accepted_by_id = user_id
        invitation.accepted_at = utcnow()


class ServiceAccountRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def by_id(self, sa_id: int) -> ServiceAccount | None:
        return await self.session.get(ServiceAccount, sa_id)

    async def in_organization(self, organization: Organization, name: str) -> ServiceAccount | None:
        return (
            await self.session.execute(
                select(ServiceAccount).where(
                    ServiceAccount.organization_id == organization.id,
                    ServiceAccount.name == name,
                )
            )
        ).scalar_one_or_none()

    async def for_organization(self, organization: Organization) -> list[ServiceAccount]:
        return (
            (
                await self.session.execute(
                    select(ServiceAccount)
                    .where(ServiceAccount.organization_id == organization.id)
                    .order_by(ServiceAccount.name)
                )
            )
            .scalars()
            .all()
        )

    async def create(
        self,
        *,
        organization: Organization,
        user_id: int,
        name: str,
        created_by_id: int,
    ) -> ServiceAccount:
        row = ServiceAccount(
            organization_id=organization.id,
            user_id=user_id,
            name=name,
            created_by_id=created_by_id,
        )
        self.session.add(row)
        await self.session.flush()
        return row

    async def suspend(self, sa: ServiceAccount) -> None:
        sa.status = "suspended"
