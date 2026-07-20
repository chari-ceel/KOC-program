FROM python:3.11-slim

WORKDIR /app

COPY agent/pyproject.toml ./pyproject.toml
COPY agent/vendor ./vendor

RUN --mount=type=cache,target=/root/.cache/pip pip install \
    $(if ls vendor/wheels/*.whl >/dev/null 2>&1; then echo "--no-index --find-links=vendor/wheels"; else echo "--index-url https://pypi.tuna.tsinghua.edu.cn/simple --retries 10 --timeout 60"; fi) \
    fastapi==0.136.1 uvicorn==0.46.0 pydantic==2.13.3 pymongo==4.17.0 python-dotenv==1.2.2 httpx==0.25.2 google-genai==1.0.0 pydantic-settings==2.10.1 pytest==7.4.4

COPY agent/app ./app
COPY agent/tests ./tests
COPY prompts ./prompts
COPY examples ./examples

EXPOSE 8010

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8010"]
