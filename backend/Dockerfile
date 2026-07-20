FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt requirements-test.txt ./
COPY vendor ./vendor

RUN --mount=type=cache,target=/root/.cache/pip \
    if ls vendor/wheels/*.whl >/dev/null 2>&1; then \
    pip install --no-index --find-links=vendor/wheels -r requirements.txt; \
    else \
    pip install --index-url https://pypi.tuna.tsinghua.edu.cn/simple --retries 10 --timeout 60 -r requirements.txt; \
    fi; \
    if ls vendor/wheels/pytest-*.whl >/dev/null 2>&1; then \
    pip install --no-index --find-links=vendor/wheels -r requirements-test.txt; \
    else \
    pip install --index-url https://pypi.tuna.tsinghua.edu.cn/simple --retries 10 --timeout 60 -r requirements-test.txt; \
    fi

COPY . .
RUN ln -s . backend

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
