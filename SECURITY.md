# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Pawtropolis Tech, please report it privately to help us fix it before public disclosure.

### Contact

- **Email**: admin@watchthelight.org
- **GitHub Issues**: For non-security bugs, use [GitHub Issues](https://github.com/watchthelight/pawtech-v2/issues)

### What to Include

When reporting a vulnerability, please include:

1. A description of the vulnerability
2. Steps to reproduce the issue
3. Potential impact
4. Any suggested fixes (optional)

### Response Time

We aim to acknowledge security reports within 48 hours and provide an initial assessment within 7 days.

## Supported Versions

We provide security updates for the latest release only. Please ensure you're running the most recent version.

## Security Best Practices

When deploying Pawtropolis Tech:

- Never commit `.env` files or credentials to version control
- Use environment variables for all sensitive configuration
- Keep database files (`data/*.db*`) in `.gitignore`
- Regularly update dependencies using `npm audit` and `npm update`
- Run the bot with minimal required permissions
- Store backups securely (see `data/backups/` - not committed to git)

## Disclosure Policy

We practice responsible disclosure:

1. Reporter notifies us privately
2. We investigate and develop a fix
3. We release a patched version
4. Public disclosure after fix is deployed (coordinated with reporter)

Thank you for helping keep Pawtropolis Tech secure!
