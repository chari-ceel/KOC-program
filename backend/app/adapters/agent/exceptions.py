class MissingRequiredContextError(Exception):
    pass


class AgentRunFailedError(Exception):
    pass


class AgentPartialSuccessError(Exception):
    def __init__(self, message: str, partial_result: dict):
        super().__init__(message)
        self.partial_result = partial_result
